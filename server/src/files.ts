import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createHash, randomBytes } from 'node:crypto'
import type { Ctx } from './http.ts'
import { HttpError } from './http.ts'
import type { Db } from './db.ts'
import { validId } from './ids.ts'

export type FileKind = 'track' | 'cover'
export interface FileRow { song_id: string; kind: FileKind; path: string; hash: string | null; size: number; mime: string | null }

const MIME_ALLOW: Record<FileKind, RegExp> = {
  track: /^audio\/[A-Za-z0-9][\w.+-]{0,62}$/,
  cover: /^image\/(png|jpeg|webp|gif)$/,
}

/** Lower-case alnum extension (max 5 chars) from a file name, or 'bin'. */
export function safeExt(fileName: unknown): string {
  const m = typeof fileName === 'string' ? /\.([A-Za-z0-9]{1,5})$/.exec(fileName) : null
  return m ? m[1].toLowerCase() : 'bin'
}

export class Files {
  constructor(private db: Db, private dataDir: string) {}

  get filesRoot(): string { return join(this.dataDir, 'files') }
  songDir(songId: string): string { return join(this.filesRoot, 'songs', validId(songId, 'song id')) }

  /** Stream/hash helper: concatenates `parts` into `tmp` (caller renames). */
  async assemble(parts: string[], tmp: string): Promise<{ hash: string; size: number }> {
    await mkdir(join(tmp, '..'), { recursive: true })
    const hash = createHash('sha256')
    let size = 0
    try {
      const out = createWriteStream(tmp)
      const source = (async function* () {
        for (const p of parts) {
          for await (const chunk of createReadStream(p)) {
            hash.update(chunk as Buffer)
            size += (chunk as Buffer).length
            yield chunk
          }
        }
      })()
      await pipeline(source, out)
    } catch (e) {
      await rm(tmp, { force: true })
      throw e
    }
    return { hash: hash.digest('hex'), size }
  }

  /**
   * Replaces the song's file of `kind` with the assembled file. `isLive` is re-checked right before the
   * row is written, so a tombstone that arrived during assembly wins (409, file removed).
   */
  async store(songId: string, kind: FileKind, fileName: unknown, mime: unknown, parts: string[], isLive: () => boolean): Promise<{ hash: string; size: number }> {
    if (typeof mime !== 'string' || !MIME_ALLOW[kind].test(mime)) throw new HttpError(415, 'Unsupported media type')
    this.songDir(songId)
    const rel = join('songs', songId, `${kind}.${safeExt(fileName)}`)
    const dest = join(this.filesRoot, rel)
    const tmp = `${dest}.${randomBytes(6).toString('hex')}.tmp`
    const { hash, size } = await this.assemble(parts, tmp)
    if (!isLive()) { await rm(tmp, { force: true }); throw new HttpError(409, 'Unknown or deleted song') }
    const old = this.row(songId, kind)
    this.db.prepare(`INSERT INTO files (song_id, kind, path, hash, size, mime) VALUES (?,?,?,?,?,?)
      ON CONFLICT(song_id, kind) DO UPDATE SET path=excluded.path, hash=excluded.hash, size=excluded.size, mime=excluded.mime`)
      .run(songId, kind, rel, hash, size, mime)
    try { await rename(tmp, dest) } catch (e) {
      await rm(tmp, { force: true })
      if (old) {
        this.db.prepare('UPDATE files SET path=?, hash=?, size=?, mime=? WHERE song_id=? AND kind=?').run(old.path, old.hash, old.size, old.mime, songId, kind)
      } else this.db.prepare('DELETE FROM files WHERE song_id = ? AND kind = ?').run(songId, kind)
      throw isLive() ? e : new HttpError(409, 'Unknown or deleted song')
    }
    if (old && old.path !== rel) await rm(join(this.filesRoot, old.path), { force: true })
    return { hash, size }
  }

  /** Startup: remove stray *.tmp files left by a crashed assemble. */
  async sweepTmp(): Promise<void> {
    const root = join(this.filesRoot, 'songs')
    let dirs: string[] = []
    try { dirs = await readdir(root) } catch { return }
    for (const d of dirs) {
      let names: string[] = []
      try { names = await readdir(join(root, d)) } catch { continue }
      for (const f of names) if (f.endsWith('.tmp')) await rm(join(root, d, f), { force: true })
    }
  }

  row(songId: string, kind: FileKind): FileRow | undefined {
    return this.db.prepare('SELECT * FROM files WHERE song_id = ? AND kind = ?').get(songId, kind) as FileRow | undefined
  }

  async remove(songId: string, kind: FileKind): Promise<boolean> {
    const row = this.row(songId, kind)
    if (!row) return false
    await rm(join(this.filesRoot, row.path), { force: true })
    this.db.prepare('DELETE FROM files WHERE song_id = ? AND kind = ?').run(songId, kind)
    return true
  }

  /** Removes every file of a song (tombstone). */
  async removeAll(songId: string): Promise<void> {
    await this.remove(songId, 'track')
    await this.remove(songId, 'cover')
    await rm(this.songDir(songId), { recursive: true, force: true })
  }

  async serve(ctx: Ctx, kind: FileKind): Promise<void> {
    const songId = validId(ctx.params.id, 'song id')
    const row = this.row(songId, kind)
    if (!row) throw new HttpError(404, 'No file')
    const full = join(this.filesRoot, row.path)
    let size: number
    try { size = (await stat(full)).size } catch { throw new HttpError(404, 'No file') }
    const headers: Record<string, string | number> = {
      'Content-Type': row.mime ?? 'application/octet-stream',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': 'sandbox',
    }
    if (row.hash) headers['X-Content-SHA256'] = row.hash
    let start = 0
    let end = size - 1
    let status = 200
    const range = ctx.req.headers.range
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
      if (!m || (m[1] === '' && m[2] === '')) throw new HttpError(416, 'Bad range', { 'Content-Range': `bytes */${size}` })
      if (m[1] === '') {
        const n = Number(m[2])
        start = Math.max(0, size - n)
      } else {
        start = Number(m[1])
        if (m[2] !== '') end = Math.min(end, Number(m[2]))
      }
      if (start >= size || start > end) throw new HttpError(416, 'Range not satisfiable', { 'Content-Range': `bytes */${size}` })
      status = 206
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    }
    headers['Content-Length'] = end - start + 1
    ctx.res.writeHead(status, headers)
    if (ctx.req.method === 'HEAD' || size === 0) { ctx.res.end(); return }
    await pipeline(createReadStream(full, { start, end }), ctx.res)
  }
}

