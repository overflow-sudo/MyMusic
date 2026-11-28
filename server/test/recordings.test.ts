import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RecordingListItem } from '../../shared/api.ts'
import { realRunner, type MediaRunner } from '../src/transcode.ts'
import { login, PASSWORD, start, type Harness } from './helpers.ts'

let h: Harness
afterEach(async () => { await h?.stop() })

const rid = (songId: string, fileName: string) => createHash('sha256').update(`${songId}/${fileName}`).digest('hex').slice(0, 32)

interface Fake extends MediaRunner { calls: string[][]; gates: (() => void)[]; hold: boolean; fail: boolean; active: number; maxActive: number }
function fakeRunner(): Fake {
  const f: Fake = {
    calls: [], gates: [], hold: false, fail: false, active: 0, maxActive: 0,
    async ffmpeg(args) {
      f.calls.push(args)
      f.active++; f.maxActive = Math.max(f.maxActive, f.active)
      try {
        if (f.hold) await new Promise<void>((r) => f.gates.push(r))
        if (f.fail) throw new Error('boom')
        await writeFile(args[args.length - 1], 'CONVERTED-OUTPUT')
      } finally { f.active-- }
    },
    async ffprobe() { return '12.5\n' },
  }
  return f
}

async function boot(media: MediaRunner = fakeRunner(), env: Record<string, string> = {}) {
  h = await start({ PUBLIC_URL: 'https://example.test', ...env }, { media })
  const { token } = await (await login(h, PASSWORD)).json() as { token: string }
  const auth = { Authorization: `Bearer ${token}` }
  const api = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(h.base + path, {
      method, headers: { ...auth, ...(typeof body === 'object' && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
    })
  await api('PUT', '/api/songs/song-0001', { id: 'song-0001', title: 'Title', artist: 'Artist', updatedAt: '2026-01-01T00:00:00.000Z' })
  return { api, auth, media }
}
type Api = Awaited<ReturnType<typeof boot>>['api']

async function rec(api: Api, over: Record<string, unknown> = {}, bytes = Buffer.from('WEBM-ORIGINAL')) {
  const songId = (over.songId as string) ?? 'song-0001'
  const fileName = (over.fileName as string) ?? 'take 1.webm'
  const { uploadId } = await (await api('POST', '/api/uploads')).json() as { uploadId: string }
  await api('PUT', `/api/uploads/${uploadId}/0`, new Uint8Array(bytes))
  return api('POST', `/api/uploads/${uploadId}/complete`, {
    target: 'recording', songId, id: rid(songId, fileName), kind: 'video', recordedAt: '2026-02-01T10:00:00.000Z',
    fileName, mime: 'video/webm;codecs=vp9,opus', ...over,
  })
}
const list = async (api: Api) => await (await api('GET', '/api/recordings')).json() as RecordingListItem[]
const urlOf = async (api: Api, id: string, q = '') => ((await (await api('GET', `/api/recordings/${id}/url${q}`)).json()) as { url: string }).url
const local = (url: string) => url.replace('https://example.test', h.base)
const ID = rid('song-0001', 'take 1.webm')

describe('recordings', () => {
  it('complete stores original, snapshots song, transcodes and lists ready', async () => {
    const { api, media } = await boot()
    const r = await rec(api)
    expect(r.status).toBe(200)
    expect(readFileSync(join(h.config.dataDir, 'files', 'rec', ID, 'orig.webm'), 'utf8')).toBe('WEBM-ORIGINAL')
    await h.app.transcoder.idle()
    const items = await list(api)
    expect(items).toEqual([{
      id: ID, songId: 'song-0001', kind: 'video', recordedAt: '2026-02-01T10:00:00.000Z', fileName: 'take 1.webm',
      size: 13, durationSec: 12.5, status: 'ready', songTitle: 'Title', songArtist: 'Artist', shared: false,
    }])
    const args = (media as ReturnType<typeof fakeRunner>).calls[0]
    expect(args.slice(0, 2)).toEqual(['-y', '-i'])
    expect(args.slice(3, -1)).toEqual(['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart'])
    expect(args[args.length - 1].endsWith('.mp4')).toBe(true)
    expect(existsSync(join(h.config.dataDir, 'files', 'rec', ID, 'out.mp4'))).toBe(true)
  })

  it('ses transcodes to m4a with audio-only args', async () => {
    const { api, media } = await boot()
    const fileName = 'a.webm'
    expect((await rec(api, { fileName, kind: 'ses', mime: 'audio/webm' })).status).toBe(200)
    await h.app.transcoder.idle()
    const args = (media as ReturnType<typeof fakeRunner>).calls[0]
    expect(args.slice(3, -1)).toEqual(['-c:a', 'aac', '-b:a', '192k'])
    expect(args[args.length - 1].endsWith('.m4a')).toBe(true)
    const u = await urlOf(api, rid('song-0001', fileName))
    expect((await fetch(local(u))).headers.get('content-type')).toBe('audio/mp4')
  })

  it('is idempotent by id and validates input', async () => {
    const { api, media } = await boot()
    expect((await rec(api)).status).toBe(200)
    expect((await rec(api, {}, Buffer.from('OTHER'))).status).toBe(200)
    await h.app.transcoder.idle()
    expect(readFileSync(join(h.config.dataDir, 'files', 'rec', ID, 'orig.webm'), 'utf8')).toBe('WEBM-ORIGINAL')
    expect((media as ReturnType<typeof fakeRunner>).calls).toHaveLength(1)
    expect(await list(api)).toHaveLength(1)
    expect((await rec(api, { fileName: 'x.webm', id: ID })).status).toBe(400) // id mismatch
    expect((await rec(api, { fileName: 'y.webm', mime: 'video/mp4' })).status).toBe(415)
    expect((await rec(api, { fileName: 'z.webm', mime: 'audio/ogg; codecs=opus' })).status).toBe(200)
    expect((await rec(api, { fileName: 'k.webm', kind: 'x' })).status).toBe(400)
    expect((await rec(api, { fileName: 'k.webm', recordedAt: 'yesterday' })).status).toBe(400)
    expect((await rec(api, { songId: 'nosuchsong', fileName: 'q.webm' })).status).toBe(409)
  })

  it('refuses new uploads for a tombstoned song but keeps existing recordings', async () => {
    const { api } = await boot()
    await rec(api)
    await h.app.transcoder.idle()
    await api('PUT', '/api/songs/song-0001', { id: 'song-0001', title: 'Title', artist: 'Artist', updatedAt: '2026-03-01T00:00:00.000Z', deletedAt: '2026-03-01T00:00:00.000Z' })
    expect((await rec(api, { fileName: 'new.webm' })).status).toBe(409)
    expect((await list(api)).map((i) => i.id)).toEqual([ID])
  })

  it('delete removes files and row, records tombstone (also for unknown ids), idempotent; re-upload 410', async () => {
    const { api } = await boot()
    await rec(api)
    await h.app.transcoder.idle()
    const dir = join(h.config.dataDir, 'files', 'rec', ID)
    expect(existsSync(dir)).toBe(true)
    const other = 'f'.repeat(32)
    h.app.db.prepare('UPDATE recordings SET share_token = ? WHERE id = ?').run('tok', ID)
    expect((await api('DELETE', `/api/recordings/${ID}`)).status).toBe(204)
    expect((await api('DELETE', `/api/recordings/${ID}`)).status).toBe(204)
    expect((await api('DELETE', `/api/recordings/${other}`)).status).toBe(204)
    expect((await api('DELETE', '/api/recordings/nope')).status).toBe(400)
    expect(existsSync(dir)).toBe(false)
    expect(h.app.db.prepare('SELECT COUNT(*) AS n FROM recordings').get()).toEqual({ n: 0 })
    const items = await list(api)
    expect(items).toHaveLength(2)
    expect(items).toContainEqual({ id: ID, deleted: true })
    expect(items).toContainEqual({ id: other, deleted: true })
    expect((await rec(api)).status).toBe(410)
    expect(existsSync(dir)).toBe(false)
  })

  it('list is newest first with tombstones last; /api/recordings needs Bearer', async () => {
    const { api } = await boot()
    await rec(api, { fileName: 'old.webm', recordedAt: '2026-01-05T00:00:00.000Z' })
    await rec(api, { fileName: 'new.webm', recordedAt: '2026-02-05T00:00:00.000Z' })
    await h.app.transcoder.idle()
    await api('DELETE', `/api/recordings/${'a'.repeat(32)}`)
    const items = await list(api)
    expect(items.map((i) => ('fileName' in i ? i.fileName : 'tomb'))).toEqual(['new.webm', 'old.webm', 'tomb'])
    expect((await fetch(h.base + '/api/recordings')).status).toBe(401)
    expect((await fetch(`${h.base}/api/recordings/${ID}/url`)).status).toBe(401)
    expect((await fetch(`${h.base}/api/recordings/${ID}`, { method: 'DELETE' })).status).toBe(401)
  })
})

describe('signed urls', () => {
  it('url is absolute, valid sig streams prefers mp4, Range works, no Bearer needed', async () => {
    const { api } = await boot()
    await rec(api)
    await h.app.transcoder.idle()
    const url = await urlOf(api, ID)
    expect(url).toMatch(new RegExp(`^https://example\\.test/files/rec/${ID}\\?exp=\\d+&sig=[0-9a-f]{64}$`))
    const exp = Number(new URL(url).searchParams.get('exp'))
    expect(exp - Math.floor(Date.now() / 1000)).toBeGreaterThan(3590)
    expect(exp - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(3600)
    const g = await fetch(local(url))
    expect(g.status).toBe(200)
    expect(g.headers.get('content-type')).toBe('video/mp4')
    expect(g.headers.get('content-disposition')).toBe('inline; filename="take_1.mp4"')
    expect(g.headers.get('x-content-type-options')).toBe('nosniff')
    expect(g.headers.get('content-security-policy')).toBe('sandbox')
    expect(await g.text()).toBe('CONVERTED-OUTPUT')
    const r = await fetch(local(url), { headers: { Range: 'bytes=10-' } })
    expect(r.status).toBe(206)
    expect(r.headers.get('content-range')).toBe('bytes 10-15/16')
    expect(await r.text()).toBe('OUTPUT')
  })

  it('bad, tampered, missing and expired signatures -> 403; download and inline sigs differ', async () => {
    const { api } = await boot()
    await rec(api)
    await h.app.transcoder.idle()
    const url = local(await urlOf(api, ID))
    const u = new URL(url)
    const bad = new URL(url); bad.searchParams.set('sig', '0'.repeat(64))
    expect((await fetch(bad)).status).toBe(403)
    const garbage = new URL(url); garbage.searchParams.set('sig', 'zz')
    expect((await fetch(garbage)).status).toBe(403)
    const exp2 = new URL(url); exp2.searchParams.set('exp', String(Number(u.searchParams.get('exp')) + 100))
    expect((await fetch(exp2)).status).toBe(403)
    expect((await fetch(`${h.base}/files/rec/${ID}`)).status).toBe(403)
    // inline sig cannot be reused for download and vice versa
    const asDownload = new URL(url); asDownload.searchParams.set('download', '1')
    expect((await fetch(asDownload)).status).toBe(403)
    const dUrl = local(await urlOf(api, ID, '?download=1'))
    const d = await fetch(dUrl)
    expect(d.status).toBe(200)
    expect(d.headers.get('content-disposition')).toBe('attachment; filename="take_1.mp4"')
    const dInline = new URL(dUrl); dInline.searchParams.delete('download')
    expect((await fetch(dInline)).status).toBe(403)
    // signature of another recording
    const other = new URL(url.replace(ID, 'e'.repeat(32)))
    expect((await fetch(other)).status).toBe(403)
    // expiry
    h.app.recordings.now = () => Date.now() + 3601 * 1000
    expect((await fetch(url)).status).toBe(403)
  })

  it('unknown recording url -> 404; valid sig for deleted recording -> 404', async () => {
    const { api } = await boot()
    expect((await api('GET', `/api/recordings/${'c'.repeat(32)}/url`)).status).toBe(404)
    await rec(api)
    const url = local(await urlOf(api, ID))
    await api('DELETE', `/api/recordings/${ID}`)
    expect((await fetch(url)).status).toBe(404)
  })
})

describe('transcode queue', () => {
  it('runs one job at a time; the second waits', async () => {
    const media = fakeRunner(); media.hold = true
    const { api } = await boot(media)
    await rec(api, { fileName: 'a.webm' })
    await rec(api, { fileName: 'b.webm' })
    await vi_waitFor(() => media.gates.length === 1)
    await new Promise((r) => setTimeout(r, 50))
    expect(media.calls).toHaveLength(1)
    expect((await list(api)).every((i) => 'status' in i && i.status === 'processing')).toBe(true)
    media.gates.shift()!()
    await vi_waitFor(() => media.gates.length === 1)
    expect(media.calls).toHaveLength(2)
    media.hold = false
    media.gates.shift()!()
    await h.app.transcoder.idle()
    expect(media.maxActive).toBe(1)
    expect((await list(api)).every((i) => 'status' in i && i.status === 'ready')).toBe(true)
  })

  it('failure -> failed and the url serves the original', async () => {
    const media = fakeRunner(); media.fail = true
    const { api } = await boot(media)
    await rec(api)
    await h.app.transcoder.idle()
    const [item] = await list(api)
    expect(item).toMatchObject({ status: 'failed', durationSec: null })
    const g = await fetch(local(await urlOf(api, ID)))
    expect(g.headers.get('content-type')).toBe('video/webm')
    expect(g.headers.get('content-disposition')).toBe('inline; filename="take_1.webm"')
    expect(await g.text()).toBe('WEBM-ORIGINAL')
    expect(readdirNoTmp(join(h.config.dataDir, 'files', 'rec', ID))).toEqual(['orig.webm'])
  })

  it('requeues rows still processing after a restart', async () => {
    const media = fakeRunner()
    const { api } = await boot(media)
    const dir = join(h.config.dataDir, 'files', 'rec', ID)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'orig.webm'), 'WEBM-ORIGINAL')
    h.app.db.prepare(`INSERT INTO recordings (id, song_id, kind, recorded_at, file_name, size, status, orig_path)
      VALUES (?,?,?,?,?,?, 'processing', ?)`).run(ID, 'song-0001', 'video', '2026-02-01T10:00:00.000Z', 'take 1.webm', 13, join('rec', ID, 'orig.webm'))
    h.app.transcoder.start() // what createApp does on boot
    await h.app.transcoder.idle()
    expect((await list(api))[0]).toMatchObject({ status: 'ready' })
  })
})

function readdirNoTmp(dir: string): string[] {
  return (execFileSync('ls', ['-A', dir]).toString().split('\n').filter(Boolean))
}
async function vi_waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) { if (cond()) return; await new Promise((r) => setTimeout(r, 10)) }
  throw new Error('condition not reached')
}

const hasFfmpeg = (() => { try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); return true } catch { return false } })()

describe.skipIf(!hasFfmpeg)('real ffmpeg', () => {
  it('converts a 1 s webm to mp4 and reads the duration', async () => {
    const { api } = await boot(realRunner)
    const src = join(mkdtempSync(join(tmpdir(), 'mm-src-')), 'in.webm')
    execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10:duration=1',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libvpx', '-b:v', '200k', '-c:a', 'libopus', '-shortest', src])
    expect((await rec(api, {}, readFileSync(src))).status).toBe(200)
    await h.app.transcoder.idle()
    const [item] = await list(api)
    expect(item).toMatchObject({ status: 'ready' })
    expect((item as { durationSec: number }).durationSec).toBeGreaterThan(0.5)
    const g = await fetch(local(await urlOf(api, ID)))
    expect(g.headers.get('content-type')).toBe('video/mp4')
    const bytes = Buffer.from(await g.arrayBuffer())
    expect(bytes.subarray(4, 8).toString()).toBe('ftyp')
  }, 60_000)
})
