import { createWriteStream } from 'node:fs'
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { Db } from './db.ts'
import type { Ctx } from './http.ts'
import { HttpError } from './http.ts'
import { validId } from './ids.ts'

export const PART_BYTES = 32 * 1024 * 1024
export const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000

export interface CompleteInput {
  body: Record<string, unknown>
  /** Absolute paths of the uploaded parts in order. */
  parts: string[]
}
/** Plug-in point for `complete`: Task 6 registers 'recording'. Throw HttpError to reject (upload dir is removed). */
export type UploadTarget = (input: CompleteInput) => Promise<unknown>

export class Uploads {
  private targets = new Map<string, UploadTarget>()
  constructor(private db: Db, private dataDir: string, private maxBytes: number) {}

  registerTarget(name: string, fn: UploadTarget): void { this.targets.set(name, fn) }

  private dir(id: string): string { return join(this.dataDir, 'uploads', id) }

  create(now = Date.now()): { uploadId: string } {
    const uploadId = randomBytes(16).toString('base64url')
    this.db.prepare('INSERT INTO uploads (id, created_at) VALUES (?, ?)').run(uploadId, new Date(now).toISOString())
    return { uploadId }
  }

  private require(id: string): string {
    validId(id, 'upload id')
    if (!this.db.prepare('SELECT 1 FROM uploads WHERE id = ?').get(id)) throw new HttpError(404, 'Unknown upload')
    return this.dir(id)
  }

  private async partSizes(dir: string): Promise<Map<number, number>> {
    const sizes = new Map<number, number>()
    let names: string[] = []
    try { names = await readdir(dir) } catch { /* none yet */ }
    for (const n of names) if (/^\d+$/.test(n)) sizes.set(Number(n), (await stat(join(dir, n))).size)
    return sizes
  }

  async putPart(ctx: Ctx): Promise<unknown> {
    const id = ctx.params.id
    const dir = this.require(id)
    if (!/^\d{1,6}$/.test(ctx.params.n)) throw new HttpError(400, 'Invalid part number')
    const n = Number(ctx.params.n)
    const others = [...(await this.partSizes(dir))].filter(([k]) => k !== n).reduce((a, [, s]) => a + s, 0)
    const room = Math.min(PART_BYTES, this.maxBytes - others)
    const declared = Number(ctx.req.headers['content-length'])
    const tooBig = () => new HttpError(413, 'Upload too large', { Connection: 'close' })
    if (Number.isFinite(declared) && declared > room) { ctx.req.resume(); throw tooBig() }
    await mkdir(dir, { recursive: true })
    const tmp = join(dir, `${n}.tmp`)
    let size = 0
    try {
      await new Promise<void>((resolve, reject) => {
        const out = createWriteStream(tmp)
        out.on('error', reject)
        out.on('finish', resolve)
        ctx.req.on('error', reject)
        ctx.req.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > room) { ctx.req.unpipe(out); out.destroy(); ctx.req.resume(); reject(tooBig()); return }
          if (!out.write(chunk)) { ctx.req.pause(); out.once('drain', () => ctx.req.resume()) }
        })
        ctx.req.on('end', () => out.end())
      })
      await rename(tmp, join(dir, String(n)))
    } catch (e) {
      await rm(tmp, { force: true })
      throw e
    }
    return { size }
  }

  async complete(id: string, body: unknown): Promise<unknown> {
    const dir = this.require(id)
    try {
      if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new HttpError(400, 'Body must be an object')
      const meta = body as Record<string, unknown>
      const target = typeof meta.target === 'string' ? this.targets.get(meta.target) : undefined
      if (!target) throw new HttpError(400, 'Unknown target')
      const sizes = await this.partSizes(dir)
      if (sizes.size === 0) throw new HttpError(400, 'No parts uploaded')
      for (let i = 0; i < sizes.size; i++) if (!sizes.has(i)) throw new HttpError(400, `Missing part ${i}`)
      const parts = [...sizes.keys()].sort((a, b) => a - b).map((n) => join(dir, String(n)))
      return await target({ body: meta, parts })
    } finally {
      await this.discard(id)
    }
  }

  private async discard(id: string): Promise<void> {
    await rm(this.dir(id), { recursive: true, force: true })
    this.db.prepare('DELETE FROM uploads WHERE id = ?').run(id)
  }

  /** Removes uploads older than 24 h. `now` is injectable for tests. */
  async cleanupStaleUploads(now = Date.now()): Promise<number> {
    const cutoff = new Date(now - UPLOAD_TTL_MS).toISOString()
    const stale = this.db.prepare('SELECT id FROM uploads WHERE created_at < ?').all(cutoff) as { id: string }[]
    for (const { id } of stale) await this.discard(id)
    return stale.length
  }
}
