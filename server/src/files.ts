import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { createHash } from 'node:crypto'
import type { Ctx } from './http.ts'
import { HttpError } from './http.ts'
import type { Db } from './db.ts'
import { validId } from './ids.ts'

export type FileKind = 'track' | 'cover'
export interface FileRow { song_id: string; kind: FileKind; path: string; hash: string | null; size: number; mime: string | null }

const MIME_RE = /^[A-Za-z0-9][\w.+-]{0,62}\/[A-Za-z0-9][\w.+-]{0,62}$/

/** Lower-case alnum extension (max 5 chars) from a file name, or 'bin'. */
export function safeExt(fileName: unknown): string {
  const m = typeof fileName === 'string' ? /\.([A-Za-z0-9]{1,5})$/.exec(fileName) : null
  return m ? m[1].toLowerCase() : 'bin'
}

export class Files {
  constructor(private db: Db, private dataDir: string) {}

  get filesRoot(): string { return join(this.dataDir, 'files') }
  songDir(songId: string): string { return join(this.filesRoot, 'songs', validId(songId, 'song id')) }

  /** Stream/hash helper: concatenates `parts` into `dest` atomically. */
  async assemble(parts: string[], dest: string): Promise<{ hash: string; size: number }> {
    await mkdir(join(dest, '..'), { recursive: true })
    const tmp = dest + '.tmp'
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
      await rename(tmp, dest)
    } catch (e) {
      await rm(tmp, { force: true })
      throw e
    }
    return { hash: hash.digest('hex'), size }
  }

  /** Replaces the song's file of `kind` with the assembled file. */
  async store(songId: string, kind: FileKind, fileName: unknown, mime: unknown, parts: string[]): Promise<{ hash: string; size: number }> {
    this.songDir(songId)
    const rel = join('songs', songId, `${kind}.${safeExt(fileName)}`)
    const { hash, size } = await this.assemble(parts, join(this.filesRoot, rel))
    const old = this.row(songId, kind)
    if (old && old.path !== rel) await rm(join(this.filesRoot, old.path), { force: true })
    const m = typeof mime === 'string' && MIME_RE.test(mime) ? mime : 'application/octet-stream'
    this.db.prepare(`INSERT INTO files (song_id, kind, path, hash, size, mime) VALUES (?,?,?,?,?,?)
      ON CONFLICT(song_id, kind) DO UPDATE SET path=excluded.path, hash=excluded.hash, size=excluded.size, mime=excluded.mime`)
      .run(songId, kind, rel, hash, size, m)
    return { hash, size }
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

