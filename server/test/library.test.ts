import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { request as httpRequest } from 'node:http'
import { login, PASSWORD, start, type Harness } from './helpers.ts'

let h: Harness
afterEach(async () => { await h?.stop() })

async function boot(env: Record<string, string> = {}) {
  h = await start(env)
  const { token } = await (await login(h, PASSWORD)).json() as { token: string }
  const auth = { Authorization: `Bearer ${token}` }
  const api = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(h.base + path, {
      method, headers: { ...auth, ...(typeof body === 'object' && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
    })
  return { auth, api }
}
const song = (over: Record<string, unknown> = {}) => ({ id: 'song-0001', title: 'T', artist: 'A', updatedAt: '2026-01-01T00:00:00.000Z', ...over })
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

async function upload(api: Awaited<ReturnType<typeof boot>>['api'], parts: Buffer[], meta: Record<string, unknown>) {
  const { uploadId } = await (await api('POST', '/api/uploads')).json() as { uploadId: string }
  for (let i = 0; i < parts.length; i++) {
    const r = await api('PUT', `/api/uploads/${uploadId}/${i}`, new Uint8Array(parts[i]), { 'Content-Type': 'application/octet-stream' })
    expect(r.status).toBe(200)
  }
  return { uploadId, complete: () => api('POST', `/api/uploads/${uploadId}/complete`, meta) }
}

describe('library', () => {
  it('newer wins, older ignored, response is the stored record', async () => {
    const { api } = await boot()
    expect(await (await api('GET', '/api/library')).json()).toEqual({ songs: [] })
    expect(await (await api('PUT', '/api/songs/song-0001', song())).json()).toMatchObject({ title: 'T' })
    const newer = song({ title: 'New', updatedAt: '2026-02-01T00:00:00.000Z' })
    expect(await (await api('PUT', '/api/songs/song-0001', newer)).json()).toEqual(newer)
    const older = await api('PUT', '/api/songs/song-0001', song({ title: 'Old', updatedAt: '2025-01-01T00:00:00.000Z' }))
    expect(older.status).toBe(200)
    expect(await older.json()).toEqual(newer)
    expect(await (await api('GET', '/api/library')).json()).toEqual({ songs: [newer] })
  })

  it('equal updatedAt keeps stored but fills missing cover and track.hash', async () => {
    const { api } = await boot()
    await api('PUT', '/api/songs/song-0001', song({ title: 'Stored', track: { fileName: 'a.mp3' } }))
    const r = await api('PUT', '/api/songs/song-0001', song({ title: 'Other', cover: { source: 'user', fileName: 'c.jpg' }, track: { fileName: 'a.mp3', hash: 'abc' } }))
    expect(await r.json()).toEqual(song({ title: 'Stored', cover: { source: 'user', fileName: 'c.jpg' }, track: { fileName: 'a.mp3', hash: 'abc' } }))
    const again = await api('PUT', '/api/songs/song-0001', song({ cover: { source: 'itunes', fileName: 'z.jpg', hash: 'zz' }, track: { fileName: 'a.mp3', hash: 'other' } }))
    expect(await again.json()).toEqual(song({ title: 'Stored', cover: { source: 'user', fileName: 'c.jpg' }, track: { fileName: 'a.mp3', hash: 'abc' } }))
  })

  it('equal updatedAt: track.hash only for the same stored track file, never a whole track', async () => {
    const { api } = await boot()
    await api('PUT', '/api/songs/song-0001', song({ title: 'Stored', track: { fileName: 'a.mp3' } }))
    const other = await api('PUT', '/api/songs/song-0001', song({ track: { fileName: 'b.mp3', hash: 'abc' } }))
    expect(await other.json()).toEqual(song({ title: 'Stored', track: { fileName: 'a.mp3' } }))
    await api('PUT', '/api/songs/song-0002', song({ id: 'song-0002', title: 'NoTrack' }))
    const adopt = await api('PUT', '/api/songs/song-0002', song({ id: 'song-0002', track: { fileName: 'a.mp3', hash: 'abc' } }))
    expect(await adopt.json()).toEqual(song({ id: 'song-0002', title: 'NoTrack' }))
  })

  it('validates id, updatedAt and shape', async () => {
    const { api } = await boot()
    expect((await api('PUT', '/api/songs/song-0001', song({ id: 'other-id-1' }))).status).toBe(400)
    expect((await api('PUT', '/api/songs/song-0001', song({ updatedAt: 'nope' }))).status).toBe(400)
    expect((await api('PUT', '/api/songs/song-0001', [1])).status).toBe(400)
    expect((await api('PUT', '/api/songs/song-0001', song({ big: 'x'.repeat(1024 * 1024) }))).status).toBe(413)
  })

  it('tombstone is stored, returned, and deletes files', async () => {
    const { api } = await boot()
    await api('PUT', '/api/songs/song-0001', song())
    const bytes = Buffer.from('hello')
    const u = await upload(api, [bytes], { target: 'cover', songId: 'song-0001', fileName: 'c.png', mime: 'image/png' })
    expect((await u.complete()).status).toBe(200)
    const t = await upload(api, [bytes], { target: 'track', songId: 'song-0001', fileName: 't.mp3', mime: 'audio/mpeg' })
    expect((await t.complete()).status).toBe(200)
    const tpath = join(h.config.dataDir, 'files', 'songs', 'song-0001', 'track.mp3')
    expect(existsSync(tpath)).toBe(true)
    const path = join(h.config.dataDir, 'files', 'songs', 'song-0001', 'cover.png')
    expect(existsSync(path)).toBe(true)
    const tomb = song({ updatedAt: '2026-03-01T00:00:00.000Z', deletedAt: '2026-03-01T00:00:00.000Z' })
    expect(await (await api('PUT', '/api/songs/song-0001', tomb)).json()).toEqual(tomb)
    expect(existsSync(path)).toBe(false)
    expect(existsSync(tpath)).toBe(false)
    expect(h.app.db.prepare('SELECT COUNT(*) AS n FROM files').get()).toEqual({ n: 0 })
    expect((await api('GET', '/api/songs/song-0001/cover')).status).toBe(404)
    expect(((await (await api('GET', '/api/library')).json()) as { songs: unknown[] }).songs).toEqual([tomb])
    const again = await upload(api, [bytes], { target: 'track', songId: 'song-0001', fileName: 'a.mp3', mime: 'audio/mpeg' })
    expect((await again.complete()).status).toBe(409)
  })
})

describe('uploads and files', () => {
  it('3 parts + complete(track) stores bytes, hash; GET streams; Range gives 206', async () => {
    const { api } = await boot()
    await api('PUT', '/api/songs/song-0001', song())
    const parts = [Buffer.from('aaaa'), Buffer.from('bbbbbb'), Buffer.from('cc')]
    const all = Buffer.concat(parts)
    const u = await upload(api, parts, { target: 'track', songId: 'song-0001', fileName: 'My Song.MP3', mime: 'audio/mpeg' })
    const r = await u.complete()
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ hash: sha(all), size: all.length })
    expect(existsSync(join(h.config.dataDir, 'files', 'songs', 'song-0001', 'track.mp3'))).toBe(true)
    expect(existsSync(join(h.config.dataDir, 'uploads', u.uploadId))).toBe(false)
    const g = await api('GET', '/api/songs/song-0001/track')
    expect(g.status).toBe(200)
    expect(g.headers.get('content-type')).toBe('audio/mpeg')
    expect(g.headers.get('content-length')).toBe(String(all.length))
    expect(g.headers.get('x-content-sha256')).toBe(sha(all))
    expect(Buffer.from(await g.arrayBuffer()).equals(all)).toBe(true)
    const rg = await api('GET', '/api/songs/song-0001/track', undefined, { Range: 'bytes=3-8' })
    expect(rg.status).toBe(206)
    expect(rg.headers.get('content-range')).toBe(`bytes 3-8/${all.length}`)
    expect(Buffer.from(await rg.arrayBuffer()).toString()).toBe('abbbbb')
    const suffix = await api('GET', '/api/songs/song-0001/track', undefined, { Range: 'bytes=-2' })
    expect(Buffer.from(await suffix.arrayBuffer()).toString()).toBe('cc')
    expect((await api('GET', '/api/songs/song-0001/track', undefined, { Range: 'bytes=99-' })).status).toBe(416)
    expect((await api('DELETE', '/api/songs/song-0001/track')).status).toBe(200)
    expect((await api('GET', '/api/songs/song-0001/track')).status).toBe(404)
  })

  it('unknown song -> 409 and upload dir removed', async () => {
    const { api } = await boot()
    const u = await upload(api, [Buffer.from('x')], { target: 'track', songId: 'nosuchsong', fileName: 'a.mp3', mime: 'audio/mpeg' })
    expect((await u.complete()).status).toBe(409)
    expect(existsSync(join(h.config.dataDir, 'uploads', u.uploadId))).toBe(false)
  })

  it('part over 32 MiB -> 413', async () => {
    const { api } = await boot()
    const { uploadId } = await (await api('POST', '/api/uploads')).json() as { uploadId: string }
    const r = await api('PUT', `/api/uploads/${uploadId}/0`, new Uint8Array(32 * 1024 * 1024 + 1))
    expect(r.status).toBe(413)
  })

  it('total over MAX_UPLOAD_BYTES -> 413; part index capped', async () => {
    const MiB = 1024 * 1024
    const { api } = await boot({ MAX_UPLOAD_BYTES: String(33 * MiB) })
    const { uploadId } = await (await api('POST', '/api/uploads')).json() as { uploadId: string }
    expect((await api('PUT', `/api/uploads/${uploadId}/0`, new Uint8Array(32 * MiB))).status).toBe(200)
    expect((await api('PUT', `/api/uploads/${uploadId}/1`, new Uint8Array(MiB + 1))).status).toBe(413)
    expect((await api('PUT', `/api/uploads/${uploadId}/1`, new Uint8Array(MiB))).status).toBe(200)
    expect((await api('PUT', `/api/uploads/${uploadId}/2`, new Uint8Array(1))).status).toBe(400)
  })

  it('concurrent parts cannot exceed MAX_UPLOAD_BYTES together', async () => {
    const MiB = 1024 * 1024
    const { api } = await boot({ MAX_UPLOAD_BYTES: String(33 * MiB) })
    const { uploadId } = await (await api('POST', '/api/uploads')).json() as { uploadId: string }
    const rs = await Promise.all([0, 1].map((i) => api('PUT', `/api/uploads/${uploadId}/${i}`, new Uint8Array(20 * MiB))))
    expect(rs.map((r) => r.status).sort()).toEqual([200, 413])
  })

  it('at most 8 active uploads -> 429; idle (>= 10 min) oldest is evicted instead', async () => {
    const { api } = await boot()
    let t = Date.now()
    h.app.uploads.now = () => t
    const ids: string[] = []
    for (let i = 0; i < 8; i++) {
      const r = await api('POST', '/api/uploads')
      expect(r.status).toBe(200)
      ids.push(((await r.json()) as { uploadId: string }).uploadId)
      t += 1000
    }
    expect((await api('POST', '/api/uploads')).status).toBe(429)
    t += 10 * 60 * 1000
    // Part activity keeps the first one alive, so the second-oldest is evicted.
    expect((await api('PUT', `/api/uploads/${ids[0]}/0`, new Uint8Array(1))).status).toBe(200)
    expect((await api('POST', '/api/uploads')).status).toBe(200)
    expect((await api('PUT', `/api/uploads/${ids[0]}/1`, new Uint8Array(1))).status).toBe(200)
    expect((await api('PUT', `/api/uploads/${ids[1]}/0`, new Uint8Array(1))).status).toBe(404)
  })

  it('DELETE /api/uploads/:id removes row and dir; refuses while a part is in flight', async () => {
    const { api, auth } = await boot()
    const { uploadId } = await (await api('POST', '/api/uploads')).json() as { uploadId: string }
    await api('PUT', `/api/uploads/${uploadId}/0`, new Uint8Array(3))
    const dir = join(h.config.dataDir, 'uploads', uploadId)
    const url = new URL(h.base)
    const req = httpRequest({ host: url.hostname, port: url.port, method: 'PUT', path: `/api/uploads/${uploadId}/1`, headers: { ...auth, 'Content-Length': '10' } })
    req.on('error', () => {})
    req.write(Buffer.alloc(3))
    await new Promise((r) => setTimeout(r, 100))
    expect((await api('DELETE', `/api/uploads/${uploadId}`)).status).toBe(409)
    req.destroy()
    for (let i = 0; i < 40 && h.app.uploads['states'].get(uploadId)?.inflight.size; i++) await new Promise((r) => setTimeout(r, 25))
    expect((await api('DELETE', `/api/uploads/${uploadId}`)).status).toBe(200)
    expect(existsSync(dir)).toBe(false)
    expect(h.app.db.prepare('SELECT COUNT(*) AS n FROM uploads').get()).toEqual({ n: 0 })
    expect((await api('DELETE', `/api/uploads/${uploadId}`)).status).toBe(404)
    expect((await fetch(h.base + `/api/uploads/${uploadId}`, { method: 'DELETE' })).status).toBe(401)
  })

  it('aborted part leaves no .tmp and the part can be retried', async () => {
    const { api, auth } = await boot()
    const { uploadId } = await (await api('POST', '/api/uploads')).json() as { uploadId: string }
    await new Promise<void>((resolve) => {
      const u = new URL(h.base)
      const req = httpRequest({ host: u.hostname, port: u.port, method: 'PUT', path: `/api/uploads/${uploadId}/0`, headers: { ...auth, 'Content-Length': '1000' } })
      req.on('error', () => resolve())
      req.write(Buffer.alloc(100))
      setTimeout(() => { req.destroy(); resolve() }, 50)
    })
    const dir = join(h.config.dataDir, 'uploads', uploadId)
    for (let i = 0; i < 40 && readdirSync(dir).length; i++) await new Promise((r) => setTimeout(r, 25))
    expect(readdirSync(dir)).toEqual([])
    expect((await api('PUT', `/api/uploads/${uploadId}/0`, new Uint8Array(5))).status).toBe(200)
  })

  it('complete closes the upload: second complete 404, parts after close refused, in-flight part blocks complete', async () => {
    const { api, auth } = await boot()
    await api('PUT', '/api/songs/song-0001', song())
    const u = await upload(api, [Buffer.from('abc')], { target: 'track', songId: 'song-0001', fileName: 'a.mp3', mime: 'audio/mpeg' })
    expect((await u.complete()).status).toBe(200)
    expect((await u.complete()).status).toBe(404)
    expect((await api('PUT', `/api/uploads/${u.uploadId}/1`, new Uint8Array(1))).status).toBe(404)
    // A part still streaming blocks complete with 409.
    const { uploadId } = await (await api('POST', '/api/uploads')).json() as { uploadId: string }
    await api('PUT', `/api/uploads/${uploadId}/0`, new Uint8Array(2))
    const url = new URL(h.base)
    const req = httpRequest({ host: url.hostname, port: url.port, method: 'PUT', path: `/api/uploads/${uploadId}/1`, headers: { ...auth, 'Content-Length': '10' } })
    req.on('error', () => {})
    req.write(Buffer.alloc(3))
    await new Promise((r) => setTimeout(r, 100))
    const c = await api('POST', `/api/uploads/${uploadId}/complete`, { target: 'track', songId: 'song-0001', fileName: 'a.mp3', mime: 'audio/mpeg' })
    expect(c.status).toBe(409)
    req.destroy()
  })

  it('rejects unsupported MIME types with 415 and sets hardening headers', async () => {
    const { api } = await boot()
    await api('PUT', '/api/songs/song-0001', song())
    const bad = await upload(api, [Buffer.from('x')], { target: 'cover', songId: 'song-0001', fileName: 'c.svg', mime: 'image/svg+xml' })
    expect((await bad.complete()).status).toBe(415)
    const bad2 = await upload(api, [Buffer.from('x')], { target: 'track', songId: 'song-0001', fileName: 'a.html', mime: 'text/html' })
    expect((await bad2.complete()).status).toBe(415)
    const ok = await upload(api, [Buffer.from('x')], { target: 'cover', songId: 'song-0001', fileName: 'c.png', mime: 'image/png' })
    expect((await ok.complete()).status).toBe(200)
    const g = await api('GET', '/api/songs/song-0001/cover')
    expect(g.headers.get('x-content-type-options')).toBe('nosniff')
    expect(g.headers.get('content-security-policy')).toBe('sandbox')
  })

  it('invalid Range forms -> 416', async () => {
    const { api } = await boot()
    await api('PUT', '/api/songs/song-0001', song())
    const u = await upload(api, [Buffer.from('abcdef')], { target: 'track', songId: 'song-0001', fileName: 'a.mp3', mime: 'audio/mpeg' })
    await u.complete()
    for (const r of ['bytes=-0', 'bytes=0-1,3-4', 'bytes=-']) {
      expect((await api('GET', '/api/songs/song-0001/track', undefined, { Range: r })).status).toBe(416)
    }
  })

  it('song validation: ISO strictness, deletedAt, title/artist; tombstone is never back-filled', async () => {
    const { api } = await boot()
    expect((await api('PUT', '/api/songs/song-0001', song({ updatedAt: '2026-01-01' }))).status).toBe(400)
    expect((await api('PUT', '/api/songs/song-0001', song({ deletedAt: 'x' }))).status).toBe(400)
    expect((await api('PUT', '/api/songs/song-0001', song({ title: 3 }))).status).toBe(400)
    const tomb = song({ deletedAt: '2026-01-01T00:00:00.000Z' })
    await api('PUT', '/api/songs/song-0001', tomb)
    expect(await (await api('PUT', '/api/songs/song-0001', song({ cover: { source: 'user', fileName: 'c.jpg' } }))).json()).toEqual(tomb)
  })

  it('cover.hash fills only when source and fileName match', async () => {
    const { api } = await boot()
    await api('PUT', '/api/songs/song-0001', song({ cover: { source: 'user', fileName: 'c.jpg' } }))
    const diff = await api('PUT', '/api/songs/song-0001', song({ cover: { source: 'user', fileName: 'd.jpg', hash: 'h' } }))
    expect(((await diff.json()) as { cover: object }).cover).toEqual({ source: 'user', fileName: 'c.jpg' })
    const same = await api('PUT', '/api/songs/song-0001', song({ cover: { source: 'user', fileName: 'c.jpg', hash: 'h' } }))
    expect(((await same.json()) as { cover: object }).cover).toEqual({ source: 'user', fileName: 'c.jpg', hash: 'h' })
  })

  it('cookie-only requests are 401 on every /api route', async () => {
    const { api } = await boot()
    const token = (await (await login(h, PASSWORD)).json() as { token: string }).token
    void api
    for (const p of ['/api/library', '/api/songs/song-0001/track', '/api/songs/song-0001/cover']) {
      expect((await fetch(h.base + p, { headers: { Cookie: `mm_session=${token}` } })).status).toBe(401)
    }
  })

  it('startup sweep removes stray .tmp under files/songs', async () => {
    const { api } = await boot()
    void api
    const dir = join(h.config.dataDir, 'files', 'songs', 'song-0001')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'track.mp3.abc.tmp'), 'x')
    writeFileSync(join(dir, 'track.mp3'), 'x')
    await h.app.files.sweepTmp()
    expect(readdirSync(dir)).toEqual(['track.mp3'])
  })

  it('requires Bearer on file and upload routes', async () => {
    await boot()
    for (const [m, p] of [['GET', '/api/songs/song-0001/track'], ['GET', '/api/songs/song-0001/cover'], ['POST', '/api/uploads'], ['PUT', '/api/uploads/abcdefgh/0'], ['GET', '/api/library']]) {
      expect((await fetch(h.base + p, { method: m })).status).toBe(401)
    }
  })

  it('rejects path-traversal ids with 400', async () => {
    const { api, auth } = await boot()
    for (const id of ['a%2Fb', 'a%5Cb', 'short']) {
      expect((await api('GET', `/api/songs/${id}/track`)).status).toBe(400)
      expect((await api('PUT', `/api/songs/${id}`, song())).status).toBe(400)
      expect((await api('PUT', `/api/uploads/${id}/0`, new Uint8Array(1))).status).toBe(400)
    }
    const raw = await new Promise<number>((resolve, reject) => {
      const u = new URL(h.base)
      const req = httpRequest({ host: u.hostname, port: u.port, path: '/api/songs/%2e%2e/track', headers: auth }, (r) => { r.resume(); resolve(r.statusCode ?? 0) })
      req.on('error', reject); req.end()
    })
    expect([400, 404]).toContain(raw) // URL parsing folds %2e%2e into a dot segment (404) before any handler runs
    const u = await upload(api, [Buffer.from('x')], { target: 'track', songId: '../../etc', fileName: 'a.mp3', mime: 'audio/mpeg' })
    expect((await u.complete()).status).toBe(400)
    expect((await api('PUT', '/api/uploads/abcdefgh/0', new Uint8Array(1))).status).toBe(404)
  })

  it('sanitizes extension', async () => {
    const { api } = await boot()
    await api('PUT', '/api/songs/song-0001', song())
    const u = await upload(api, [Buffer.from('x')], { target: 'track', songId: 'song-0001', fileName: '../x.mp3/..%2f', mime: 'audio/mpeg' })
    expect((await u.complete()).status).toBe(200)
    expect(existsSync(join(h.config.dataDir, 'files', 'songs', 'song-0001', 'track.bin'))).toBe(true)
  })

  it('cleans stale uploads after 24 h (injected clock)', async () => {
    const { api } = await boot()
    const { uploadId } = await (await api('POST', '/api/uploads')).json() as { uploadId: string }
    await api('PUT', `/api/uploads/${uploadId}/0`, new Uint8Array(3))
    const dir = join(h.config.dataDir, 'uploads', uploadId)
    expect(existsSync(dir)).toBe(true)
    const now = Date.now()
    expect(await h.app.uploads.cleanupStaleUploads(now + 23 * 3600_000)).toBe(0)
    expect(existsSync(dir)).toBe(true)
    expect(await h.app.uploads.cleanupStaleUploads(now + 25 * 3600_000)).toBe(1)
    expect(existsSync(dir)).toBe(false)
    expect(h.app.db.prepare('SELECT COUNT(*) AS n FROM uploads').get()).toEqual({ n: 0 })
    const orphan = join(h.config.dataDir, 'uploads', 'orphan-dir-1')
    mkdirSync(orphan, { recursive: true })
    await h.app.uploads.cleanupStaleUploads(now)
    expect(existsSync(orphan)).toBe(false)
  })
})
