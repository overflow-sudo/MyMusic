import type { SongRecord } from '../../shared/api.ts'
import type { Db } from './db.ts'
import type { Files } from './files.ts'
import { HttpError } from './http.ts'
import { validId } from './ids.ts'

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/
const isIso = (v: unknown): v is string => typeof v === 'string' && ISO_RE.test(v) && Number.isFinite(Date.parse(v))
const ts = (v: unknown): number => (typeof v === 'string' ? Date.parse(v) : NaN)

export class Library {
  constructor(private db: Db, private files: Files) {}

  list(): SongRecord[] {
    return (this.db.prepare('SELECT json FROM songs ORDER BY id').all() as { json: string }[])
      .map((r) => JSON.parse(r.json) as SongRecord)
  }

  get(id: string): SongRecord | undefined {
    const r = this.db.prepare('SELECT json FROM songs WHERE id = ?').get(id) as { json: string } | undefined
    return r ? (JSON.parse(r.json) as SongRecord) : undefined
  }

  /** null = unknown song, 'deleted' = tombstoned. */
  status(id: string): 'live' | 'deleted' | 'unknown' {
    const r = this.db.prepare('SELECT deleted_at FROM songs WHERE id = ?').get(id) as { deleted_at: string | null } | undefined
    return !r ? 'unknown' : r.deleted_at ? 'deleted' : 'live'
  }

  private save(song: SongRecord): void {
    this.db.prepare(`INSERT INTO songs (id, json, updated_at, deleted_at) VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at`)
      .run(song.id, JSON.stringify(song), song.updatedAt, typeof song.deletedAt === 'string' && song.deletedAt ? song.deletedAt : null)
  }

  async put(pathId: string, body: unknown): Promise<SongRecord> {
    const id = validId(pathId, 'song id')
    if (!isObj(body)) throw new HttpError(400, 'Song must be an object')
    if (body.id !== id) throw new HttpError(400, 'Song id does not match path')
    if (!isIso(body.updatedAt)) throw new HttpError(400, 'updatedAt must be an ISO date string')
    if (body.deletedAt !== undefined && !isIso(body.deletedAt)) throw new HttpError(400, 'deletedAt must be an ISO date string')
    if (typeof body.title !== 'string' || typeof body.artist !== 'string') throw new HttpError(400, 'title and artist must be strings')
    const incoming = body as SongRecord
    const stored = this.get(id)
    const inT = ts(incoming.updatedAt)
    const stT = stored ? ts(stored.updatedAt) : -Infinity
    if (!stored || inT > stT) {
      this.save(incoming)
      if (typeof incoming.deletedAt === 'string' && incoming.deletedAt) await this.files.removeAll(id)
      return incoming
    }
    if (inT === stT && !stored.deletedAt) {
      // Spec decision 7: automatic backfills do not bump updatedAt; keep the non-empty side.
      const merged: SongRecord = { ...stored }
      let changed = false
      const stCover = isObj(stored.cover) ? stored.cover : undefined
      const inCover = isObj(incoming.cover) ? incoming.cover : undefined
      if (!stored.cover && inCover) { merged.cover = inCover; changed = true }
      else if (stCover && inCover && !stCover.hash && inCover.hash
        && stCover.source === inCover.source && stCover.fileName === inCover.fileName) {
        merged.cover = { ...stCover, hash: inCover.hash }; changed = true
      }
      const inTrack = isObj(incoming.track) ? incoming.track : undefined
      const stTrack = isObj(stored.track) ? stored.track : undefined
      if (inTrack?.hash && !stTrack?.hash) {
        merged.track = { ...(stTrack ?? inTrack), hash: inTrack.hash }
        changed = true
      }
      if (changed) { this.save(merged); return merged }
    }
    return stored
  }
}
