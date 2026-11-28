import { createHash, randomBytes } from 'node:crypto'
import { readdirSync, rmdirSync, rmSync } from 'node:fs'
import { rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { RecordingInfo, RecordingListItem } from '../../shared/api.ts'
import type { Config } from './config.ts'
import type { Db } from './db.ts'
import type { Files } from './files.ts'
import { serveFile } from './files.ts'
import { HttpError, type Ctx, type Router } from './http.ts'
import type { Library } from './library.ts'
import { SIGNED_URL_TTL_SEC, sign, verify } from './signing.ts'
import type { Transcoder } from './transcode.ts'
import type { Uploads } from './uploads.ts'
import { validId } from './ids.ts'

const REC_ID_RE = /^[0-9a-f]{32}$/
const MIME_RE = /^(video\/webm|audio\/webm|audio\/ogg)(\s*;\s*codecs\s*=\s*("[\w.,\s-]{1,100}"|[\w.,-]{1,100}))?$/i
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/

interface Row {
  id: string; song_id: string; kind: 'video' | 'ses'; recorded_at: string; file_name: string; size: number
  mime: string | null; duration_sec: number | null; status: 'processing' | 'ready' | 'failed'; orig_path: string | null; out_path: string | null
  song_title: string; song_artist: string; share_token: string | null
}

export const recordingId = (songId: string, fileName: string): string =>
  createHash('sha256').update(`${songId}/${fileName}`).digest('hex').slice(0, 32)

function recId(v: unknown): string {
  if (typeof v !== 'string' || !REC_ID_RE.test(v)) throw new HttpError(400, 'Invalid recording id')
  return v
}

/** ASCII-only download name: sanitized stem of the original name + the served file's extension. */
function safeName(fileName: string, ext: string): string {
  const stem = fileName.replace(/\.[^.]*$/, '').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '').slice(0, 80) || 'recording'
  return `${stem}.${ext}`
}

/** RFC 5987 value of the real (unicode) name; control chars, quotes and separators are dropped first. */
function utf8Name(fileName: string, ext: string): string {
  const stem = fileName.replace(/\.[^.]*$/, '').replace(/[\x00-\x1f\x7f"\\/]+/g, '_').slice(0, 80) || 'recording'
  return encodeURIComponent(`${stem}.${ext}`).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

export class Recordings {
  constructor(private db: Db, private files: Files, private lib: Library, private transcoder: Transcoder, private config: Config) {}

  private get root(): string { return join(this.files.filesRoot, 'rec') }
  now: () => number = Date.now

  private row(id: string): Row | undefined { return this.db.prepare('SELECT * FROM recordings WHERE id = ?').get(id) as Row | undefined }
  private tombstoned(id: string): boolean { return !!this.db.prepare('SELECT 1 FROM recording_tombstones WHERE id = ?').get(id) }

  list(): RecordingListItem[] {
    const rows = this.db.prepare('SELECT * FROM recordings ORDER BY recorded_at DESC, id').all() as Row[]
    const live: RecordingInfo[] = rows.map((r) => ({
      id: r.id, songId: r.song_id, kind: r.kind, recordedAt: r.recorded_at, fileName: r.file_name, size: r.size,
      durationSec: r.duration_sec, status: r.status, songTitle: r.song_title, songArtist: r.song_artist, shared: !!r.share_token,
    }))
    const tombs = this.db.prepare('SELECT id FROM recording_tombstones ORDER BY deleted_at DESC, id').all() as { id: string }[]
    return [...live, ...tombs.map((t) => ({ id: t.id, deleted: true as const }))]
  }

  /** Upload target 'recording'. */
  async complete(body: Record<string, unknown>, parts: string[]): Promise<unknown> {
    const songId = validId(body.songId, 'song id')
    const { fileName, mime, kind, recordedAt } = body
    if (typeof fileName !== 'string' || fileName === '' || fileName.length > 255) throw new HttpError(400, 'Invalid fileName')
    if (kind !== 'video' && kind !== 'ses') throw new HttpError(400, 'Invalid kind')
    if (typeof recordedAt !== 'string' || !ISO_RE.test(recordedAt) || !Number.isFinite(Date.parse(recordedAt))) throw new HttpError(400, 'recordedAt must be an ISO date string')
    const id = recId(body.id)
    if (id !== recordingId(songId, fileName)) throw new HttpError(400, 'Recording id does not match songId and fileName')
    if (typeof mime !== 'string' || !MIME_RE.test(mime)) throw new HttpError(415, 'Unsupported media type')
    const baseMime = mime.split(';')[0].trim().toLowerCase()
    if ((kind === 'video') !== (baseMime === 'video/webm')) throw new HttpError(400, 'kind does not match mime')
    const check = (): 'dup' | undefined => {
      if (this.tombstoned(id)) throw new HttpError(410, 'Recording was deleted')
      if (this.row(id)) return 'dup'
      if (this.lib.status(songId) !== 'live') throw new HttpError(409, 'Unknown or deleted song')
    }
    if (check() === 'dup') return { id, status: this.row(id)!.status }
    const dir = join(this.root, id)
    const tmp = join(dir, `orig.${randomBytes(6).toString('hex')}.tmp`)
    const { size } = await this.files.assemble(parts, tmp)
    const rel = join('rec', id, 'orig.webm')
    try {
      if (check() === 'dup') { await rm(tmp, { force: true }); return { id, status: this.row(id)!.status } }
    } catch (e) { await rm(tmp, { force: true }); throw e }
    const song = this.lib.get(songId)!
    this.db.prepare(`INSERT INTO recordings (id, song_id, kind, recorded_at, file_name, size, status, orig_path, song_title, song_artist, mime)
      VALUES (?,?,?,?,?,?, 'processing', ?,?,?,?)`).run(id, songId, kind, recordedAt, fileName, size, rel, song.title, song.artist, baseMime)
    try { await rename(tmp, join(this.root, id, 'orig.webm')) } catch (e) {
      this.db.prepare("DELETE FROM recordings WHERE id = ? AND status = 'processing'").run(id)
      await rm(tmp, { force: true })
      if (this.tombstoned(id)) throw new HttpError(410, 'Recording was deleted')
      throw e
    }
    this.transcoder.enqueue(id)
    return { id, status: 'processing' }
  }

  /** Idempotent; records a tombstone even for unknown ids. */
  async remove(idRaw: string): Promise<void> {
    const id = recId(idRaw)
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM recordings WHERE id = ?').run(id) // share token goes with the row
      this.db.prepare('INSERT OR IGNORE INTO recording_tombstones (id, deleted_at) VALUES (?, ?)').run(id, new Date(this.now()).toISOString())
    })()
    this.transcoder.cancel(id)
    await rm(join(this.root, id), { recursive: true, force: true })
  }

  /** Startup: remove stray *.tmp files and empty recording dirs. */
  sweep(): void {
    let dirs: string[] = []
    try { dirs = readdirSync(this.root) } catch { return }
    for (const d of dirs) {
      const dir = join(this.root, d)
      try {
        for (const f of readdirSync(dir)) if (f.includes('.tmp')) rmSync(join(dir, f), { force: true })
        if (readdirSync(dir).length === 0) rmdirSync(dir)
      } catch { /* not a dir / raced */ }
    }
  }

  signedUrl(idRaw: string, download: boolean): { url: string } {
    const id = recId(idRaw)
    if (!this.row(id)) throw new HttpError(404, 'Unknown recording')
    const exp = Math.floor(this.now() / 1000) + SIGNED_URL_TTL_SEC
    const sig = sign(this.config.signingSecret, id, exp, download)
    return { url: `${this.config.publicUrl}/files/rec/${id}?exp=${exp}&sig=${sig}${download ? '&download=1' : ''}` }
  }

  /** Unauthenticated route: access is the signature alone. */
  async serve(ctx: Ctx): Promise<void> {
    const id = recId(ctx.params.id)
    const download = ctx.url.searchParams.get('download') === '1'
    if (!verify(this.config.signingSecret, id, ctx.url.searchParams.get('exp'), ctx.url.searchParams.get('sig'), download, Math.floor(this.now() / 1000))) {
      throw new HttpError(403, 'Invalid or expired link')
    }
    const row = this.row(id)
    if (!row) throw new HttpError(404, 'Unknown recording')
    const ready = row.status === 'ready' && row.out_path
    const rel = ready ? row.out_path! : row.orig_path
    if (!rel) throw new HttpError(404, 'No file')
    const ext = !ready ? 'webm' : row.kind === 'video' ? 'mp4' : 'm4a'
    const type = !ready ? (row.mime ?? (row.kind === 'video' ? 'video/webm' : 'audio/webm')) : row.kind === 'video' ? 'video/mp4' : 'audio/mp4'
    await serveFile(ctx, join(this.files.filesRoot, rel), {
      'Content-Type': type,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${safeName(row.file_name, ext)}"; filename*=UTF-8''${utf8Name(row.file_name, ext)}`,
    })
  }
}

export function registerRecordingRoutes(router: Router, rec: Recordings, uploads: Uploads): void {
  uploads.registerTarget('recording', ({ body, parts }) => rec.complete(body, parts))
  router.add('GET', '/api/recordings', () => rec.list())
  router.add('GET', '/api/recordings/:id/url', (ctx) => rec.signedUrl(ctx.params.id, ctx.url.searchParams.get('download') === '1'))
  router.add('DELETE', '/api/recordings/:id', async (ctx) => {
    await rec.remove(ctx.params.id)
    ctx.res.writeHead(204)
    ctx.res.end()
  })
  router.add('GET', '/files/rec/:id', (ctx) => rec.serve(ctx), { auth: false })
}

