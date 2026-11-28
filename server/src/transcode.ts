import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import type { Db } from './db.ts'
import type { Logger } from './log.ts'

export interface RunOpts { timeoutMs: number; signal?: AbortSignal }
/** Injected so tests need no ffmpeg. Both reject on non-zero exit, timeout or abort. */
export interface MediaRunner {
  ffmpeg(args: string[], opts: RunOpts): Promise<void>
  ffprobe(args: string[], opts: RunOpts): Promise<string>
}

export const SAFE_IN = ['-protocol_whitelist', 'file', '-format_whitelist', 'matroska,webm,ogg']
export const TRANSCODE_TIMEOUT_MS = 30 * 60 * 1000

function run(bin: string, args: string[], opts: RunOpts): Promise<string> {
  return new Promise((resolve, reject) => {
    // args array, never a shell.
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    let done = false
    const finish = (e?: Error) => {
      if (done) return
      done = true
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
      if (e) reject(e); else resolve(out)
    }
    const kill = () => { child.kill('SIGKILL') }
    const timer = setTimeout(() => { kill(); finish(new Error(`${bin} timed out`)) }, opts.timeoutMs)
    const onAbort = () => { kill(); finish(new Error(`${bin} aborted`)) }
    if (opts.signal?.aborted) onAbort(); else opts.signal?.addEventListener('abort', onAbort)
    child.stdout.on('data', (d: Buffer) => { if (out.length < 65536) out += d.toString() })
    child.stderr.on('data', (d: Buffer) => { err = (err + d.toString()).slice(-2000) })
    child.on('error', (e) => finish(e))
    child.on('close', (code) => finish(code === 0 ? undefined : new Error(`${bin} exited with ${code}: ${err.trim().split('\n').pop() ?? ''}`)))
  })
}

export const realRunner: MediaRunner = {
  ffmpeg: async (args, opts) => { await run('ffmpeg', args, opts) },
  ffprobe: (args, opts) => run('ffprobe', args, opts),
}

interface Row { id: string; kind: 'video' | 'ses'; orig_path: string | null; status: string; mime: string | null }

/** One job at a time. Rows left 'processing' are requeued by `start()`. */
export class Transcoder {
  private queue: string[] = []
  private running: Promise<void> | null = null
  private ctl: AbortController | null = null
  private stopped = false
  private current: string | null = null

  constructor(
    private db: Db, private filesRoot: string, private media: MediaRunner, private logger: Logger,
    private timeoutMs = TRANSCODE_TIMEOUT_MS,
  ) {}

  /** Requeue every row still 'processing' (after a restart). */
  start(): void {
    const rows = this.db.prepare("SELECT id FROM recordings WHERE status = 'processing' ORDER BY recorded_at").all() as { id: string }[]
    for (const r of rows) this.enqueue(r.id)
  }

  enqueue(id: string): void {
    if (this.stopped || this.queue.includes(id) || this.current === id) return
    this.queue.push(id)
    this.running ??= this.loop()
  }

  /** Resolves when the queue is empty and nothing runs. */
  async idle(): Promise<void> { while (this.running) await this.running }

  /** Drops a queued job or kills the running one (recording deleted). */
  cancel(id: string): void {
    this.queue = this.queue.filter((q) => q !== id)
    if (this.current === id) this.ctl?.abort()
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.queue = []
    this.ctl?.abort()
    await this.idle()
  }

  private async loop(): Promise<void> {
    try {
      for (let id = this.queue.shift(); id !== undefined; id = this.queue.shift()) {
        this.current = id
        try { await this.job(id) } catch (e) { this.logger.error('transcode job crashed', { id, message: e instanceof Error ? e.message : String(e) }) }
        this.current = null
      }
    } finally { this.running = null }
  }

  private async job(id: string): Promise<void> {
    const row = this.db.prepare('SELECT id, kind, orig_path, status, mime FROM recordings WHERE id = ?').get(id) as Row | undefined
    if (!row || row.status !== 'processing' || !row.orig_path) return
    const dir = join(this.filesRoot, 'rec', id)
    const ext = row.kind === 'video' ? 'mp4' : 'm4a'
    const outRel = join('rec', id, `out.${ext}`)
    const tmp = join(dir, `out.${randomBytes(6).toString('hex')}.tmp.${ext}`)
    this.ctl = new AbortController()
    const opts: RunOpts = { timeoutMs: this.timeoutMs, signal: this.ctl.signal }
    try {
      // Stale tmp files from a crash.
      for (const f of await readdir(dir).catch(() => [] as string[])) if (/^out\..*\.tmp/.test(f)) await rm(join(dir, f), { force: true })
      const input = join(this.filesRoot, row.orig_path)
      const codec = row.kind === 'video'
        ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart']
        : ['-c:a', 'aac', '-b:a', '192k']
      // Untrusted input: local files only, and the demuxer is forced so playlists (HLS/concat) are never parsed.
      const demuxer = row.mime === 'audio/ogg' ? 'ogg' : 'matroska'
      await this.media.ffmpeg(['-y', ...SAFE_IN, '-f', demuxer, '-i', input, ...codec, tmp], opts)
      let duration: number | null = null
      try {
        const out = await this.media.ffprobe(['-v', 'error', '-protocol_whitelist', 'file', '-f', 'mov', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', tmp], opts)
        const d = Number.parseFloat(out.trim())
        duration = Number.isFinite(d) ? d : null
      } catch { /* duration is optional */ }
      if (!this.db.prepare('SELECT 1 FROM recordings WHERE id = ?').get(id)) { await rm(tmp, { force: true }); return }
      await rename(tmp, join(this.filesRoot, outRel))
      const r = this.db.prepare("UPDATE recordings SET status = 'ready', out_path = ?, duration_sec = ? WHERE id = ? AND status = 'processing'").run(outRel, duration, id)
      if (r.changes === 0) await rm(join(this.filesRoot, outRel), { force: true }) // deleted meanwhile
    } catch (e) {
      await rm(tmp, { force: true })
      if (this.stopped) return // shutting down: stays 'processing', requeued on next start
      this.logger.error('transcode failed', { id, message: e instanceof Error ? e.message : String(e) })
      this.db.prepare("UPDATE recordings SET status = 'failed' WHERE id = ? AND status = 'processing'").run(id)
    } finally { this.ctl = null }
  }
}
