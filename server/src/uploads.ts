import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { Db } from './db.ts'
import type { Ctx } from './http.ts'
import { HttpError } from './http.ts'
import { ID_RE, validId } from './ids.ts'

export const PART_BYTES = 32 * 1024 * 1024
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000
export const MAX_OPEN_UPLOADS = 8

export interface CompleteInput {
  body: Record<string, unknown>
  /** Absolute paths of the uploaded parts in order. */
  parts: string[]
}
/** Plug-in point for `complete`: Task 6 registers 'recording'. Throw HttpError to reject (upload dir is removed). */
export type UploadTarget = (input: CompleteInput) => Promise<unknown>

interface State { parts: Map<number, number>; inflight: Map<number, number>; closed: boolean }

export class Uploads {
  private targets = new Map<string, UploadTarget>()
  private states = new Map<string, State>()
  constructor(private db: Db, private dataDir: string, private maxBytes: number) {}

  registerTarget(name: string, fn: UploadTarget): void { this.targets.set(name, fn) }

  private dir(id: string): string { return join(this.dataDir, 'uploads', id) }
  private get maxParts(): number { return Math.ceil(this.maxBytes / PART_BYTES) }

  create(now = Date.now()): { uploadId: string } {
    const { n } = this.db.prepare('SELECT COUNT(*) AS n FROM uploads').get() as { n: number }
    if (n >= MAX_OPEN_UPLOADS) throw new HttpError(429, 'Too many open uploads', { 'Retry-After': '60' })
    const uploadId = randomBytes(16).toString('base64url')
    this.db.prepare('INSERT INTO uploads (id, created_at) VALUES (?, ?)').run(uploadId, new Date(now).toISOString())
    return { uploadId }
  }

  private exists(id: string): boolean { return !!this.db.prepare('SELECT 1 FROM uploads WHERE id = ?').get(id) }

  private async state(id: string): Promise<State> {
    validId(id, 'upload id')
    let st = this.states.get(id)
    if (st) return st
    if (!this.exists(id)) throw new HttpError(404, 'Unknown upload')
    const parts = new Map<number, number>()
    let names: string[] = []
    try { names = await readdir(this.dir(id)) } catch { /* none yet */ }
    for (const f of names) if (/^\d+$/.test(f)) parts.set(Number(f), (await stat(join(this.dir(id), f))).size)
    st = this.states.get(id) ?? { parts, inflight: new Map(), closed: false }
    this.states.set(id, st)
    return st
  }

  async putPart(ctx: Ctx): Promise<unknown> {
    const id = ctx.params.id
    validId(id, 'upload id')
    if (!/^\d{1,6}$/.test(ctx.params.n)) throw new HttpError(400, 'Invalid part number')
    const n = Number(ctx.params.n)
    if (n >= this.maxParts) throw new HttpError(400, 'Part number out of range')
    const st = await this.state(id)
    if (st.closed) throw new HttpError(409, 'Upload is being completed')
    if (!this.exists(id)) throw new HttpError(404, 'Unknown upload')
    if (st.inflight.has(n)) throw new HttpError(409, 'Part already being uploaded')
    let others = 0
    for (const [k, s] of st.parts) if (k !== n) others += s
    for (const s of st.inflight.values()) others += s
    const room = Math.min(PART_BYTES, this.maxBytes - others)
    const declared = Number(ctx.req.headers['content-length'])
    const reserve = Number.isFinite(declared) ? declared : room
    const tooBig = () => new HttpError(413, 'Upload too large', { Connection: 'close' })
    if (reserve > room) { ctx.req.resume(); throw tooBig() }
    st.inflight.set(n, reserve)
    const dir = this.dir(id)
    const tmp = join(dir, `${n}.${randomBytes(6).toString('hex')}.tmp`)
    let size = 0
    try {
      await mkdir(dir, { recursive: true })
      const limit = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          size += chunk.length
          if (size > reserve) cb(tooBig())
          else cb(null, chunk)
        },
      })
      await pipeline(ctx.req, limit, createWriteStream(tmp))
      if (st.closed || !this.exists(id)) throw new HttpError(409, 'Upload is gone')
      await rename(tmp, join(dir, String(n)))
      if (st.closed || !this.exists(id)) { await rm(join(dir, String(n)), { force: true }); throw new HttpError(409, 'Upload is gone') }
      st.parts.set(n, size)
    } catch (e) {
      await rm(tmp, { force: true })
      throw e
    } finally {
      st.inflight.delete(n)
    }
    return { size }
  }

  async complete(id: string, body: unknown): Promise<unknown> {
    validId(id, 'upload id')
    const st = await this.state(id)
    if (st.closed) throw new HttpError(409, 'Upload is being completed')
    if (st.inflight.size > 0) throw new HttpError(409, 'A part is still being uploaded')
    // Close first: no part can be added or swept from here on; later calls see 404.
    st.closed = true
    this.db.prepare('DELETE FROM uploads WHERE id = ?').run(id)
    const dir = this.dir(id)
    try {
      if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'Body must be an object')
      const meta = body as Record<string, unknown>
      const target = typeof meta.target === 'string' ? this.targets.get(meta.target) : undefined
      if (!target) throw new HttpError(400, 'Unknown target')
      if (st.parts.size === 0) throw new HttpError(400, 'No parts uploaded')
      for (let i = 0; i < st.parts.size; i++) if (!st.parts.has(i)) throw new HttpError(400, `Missing part ${i}`)
      const parts = [...st.parts.keys()].sort((a, b) => a - b).map((k) => join(dir, String(k)))
      return await target({ body: meta, parts })
    } finally {
      await rm(dir, { recursive: true, force: true })
      this.states.delete(id)
    }
  }

  /** Removes uploads older than 24 h and stray upload dirs (no row, or mtime older than 24 h). `now` is injectable. */
  async cleanupStaleUploads(now = Date.now()): Promise<number> {
    const cutoff = new Date(now - UPLOAD_TTL_MS).toISOString()
    const stale = this.db.prepare('SELECT id FROM uploads WHERE created_at < ?').all(cutoff) as { id: string }[]
    let removed = 0
    for (const { id } of stale) {
      const st = this.states.get(id)
      if (st?.closed) continue
      this.db.prepare('DELETE FROM uploads WHERE id = ?').run(id)
      this.states.delete(id)
      await rm(this.dir(id), { recursive: true, force: true })
      removed++
    }
    let names: string[] = []
    try { names = await readdir(join(this.dataDir, 'uploads')) } catch { /* no dir yet */ }
    for (const name of names) {
      if (!ID_RE.test(name) || this.states.get(name)?.closed) continue
      const full = this.dir(name)
      let old = false
      try { old = now - (await stat(full)).mtimeMs > UPLOAD_TTL_MS } catch { continue }
      if (!this.exists(name) || old) {
        if (this.states.get(name)?.inflight.size) continue
        this.db.prepare('DELETE FROM uploads WHERE id = ?').run(name)
        this.states.delete(name)
        await rm(full, { recursive: true, force: true })
        removed++
      }
    }
    return removed
  }
}
