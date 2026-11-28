import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { login, PASSWORD, start, type Harness } from './helpers.ts'

let h: Harness
afterEach(async () => { await h?.stop() })

const ORIGIN = 'https://example.test'
const rid = (songId: string, fileName: string) => createHash('sha256').update(`${songId}/${fileName}`).digest('hex').slice(0, 32)

async function boot(songTitle = 'Title') {
  h = await start({ PUBLIC_URL: ORIGIN })
  const { token } = await (await login(h, PASSWORD)).json() as { token: string }
  const auth = { Authorization: `Bearer ${token}` }
  const api = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(h.base + path, {
      method, headers: { ...auth, ...(typeof body === 'object' && !(body instanceof Uint8Array) ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body),
    })
  const song = (id: string, title: string, extra: Record<string, unknown> = {}) =>
    api('PUT', `/api/songs/${id}`, { id, title, artist: 'Artist', updatedAt: '2026-01-01T00:00:00.000Z', ...extra })
  await song('song-0001', songTitle)
  return { api, song, token }
}
type Api = Awaited<ReturnType<typeof boot>>['api']

async function upload(api: Api, bytes: Buffer, body: Record<string, unknown>) {
  const { uploadId } = await (await api('POST', '/api/uploads')).json() as { uploadId: string }
  await api('PUT', `/api/uploads/${uploadId}/0`, new Uint8Array(bytes))
  return api('POST', `/api/uploads/${uploadId}/complete`, body)
}
async function rec(api: Api, content = 'WEBM-ORIGINAL', songId = 'song-0001', fileName = 'take 1.webm') {
  await upload(api, Buffer.from(content), {
    target: 'recording', songId, id: rid(songId, fileName), kind: 'ses', recordedAt: '2026-02-01T10:00:00.000Z', fileName, mime: 'audio/webm;codecs=opus',
  })
  return rid(songId, fileName)
}
const share = async (api: Api, id: string) => (await (await api('POST', `/api/recordings/${id}/share`)).json() as { url: string }).url
const tokenOf = (url: string) => url.split('/r/')[1]

describe('share API', () => {
  it('creates a stable url, lists shared, and revoke gives 404', async () => {
    const { api } = await boot()
    const id = await rec(api)
    const r = await api('POST', `/api/recordings/${id}/share`)
    expect(r.status).toBe(200)
    const { url } = await r.json() as { url: string }
    expect(url).toMatch(/^https:\/\/example\.test\/r\/[A-Za-z0-9_-]{43}$/)
    expect(await share(api, id)).toBe(url)
    const list = await (await api('GET', '/api/recordings')).json() as { id: string; shared?: boolean }[]
    expect(list.find((x) => x.id === id)?.shared).toBe(true)
    const t = tokenOf(url)
    expect((await fetch(`${h.base}/r/${t}`)).status).toBe(200)
    expect((await api('DELETE', `/api/recordings/${id}/share`)).status).toBe(204)
    expect((await fetch(`${h.base}/r/${t}`)).status).toBe(404)
    expect((await fetch(`${h.base}/r/${t}/file`)).status).toBe(404)
    expect((await (await api('GET', '/api/recordings')).json() as { shared?: boolean }[])[0].shared).toBe(false)
    expect(tokenOf(await share(api, id))).not.toBe(t)
  })

  it('needs Bearer and a known recording', async () => {
    const { api } = await boot()
    expect((await fetch(`${h.base}/api/recordings/${'a'.repeat(32)}/share`, { method: 'POST' })).status).toBe(401)
    expect((await api('POST', `/api/recordings/${'a'.repeat(32)}/share`)).status).toBe(404)
  })
})

describe('public share page', () => {
  it('escapes html, is noindex, has CSP and the player', async () => {
    const { api } = await boot('<script>alert(1)</script>')
    const id = await rec(api)
    const t = tokenOf(await share(api, id))
    const r = await fetch(`${h.base}/r/${t}`)
    const html = await r.text()
    expect(html).not.toContain('<script>alert')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).toContain('<meta name="robots" content="noindex">')
    expect(html).toContain(`src="/r/${t}/file"`)
    expect(html).toContain(`href="/r/${t}/file?download=1"`)
    expect(html).toContain('Artist')
    expect(html).toContain('<audio')
    expect(html).not.toContain('<img')
    expect(r.headers.get('content-security-policy')).toBe("default-src 'self'; img-src 'self'; media-src 'self'; style-src 'self' 'unsafe-inline'")
    expect(r.headers.get('referrer-policy')).toBe('no-referrer')
    expect(r.headers.get('content-type')).toContain('text/html')
    expect(html).not.toContain(id)
  })

  it('shows the cover only when one exists', async () => {
    const { api } = await boot()
    const id = await rec(api)
    const t = tokenOf(await share(api, id))
    expect((await fetch(`${h.base}/r/${t}/cover`)).status).toBe(404)
    await upload(api, Buffer.from('PNGDATA'), { target: 'cover', songId: 'song-0001', fileName: 'c.png', mime: 'image/png' })
    const html = await (await fetch(`${h.base}/r/${t}`)).text()
    expect(html).toContain(`src="/r/${t}/cover"`)
    const c = await fetch(`${h.base}/r/${t}/cover`)
    expect(c.status).toBe(200)
    expect(await c.text()).toBe('PNGDATA')
    expect(c.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('unknown token is a 404 page; file supports Range and download', async () => {
    const { api } = await boot()
    expect((await fetch(`${h.base}/r/${'x'.repeat(43)}`)).status).toBe(404)
    expect((await fetch(`${h.base}/r/short`)).status).toBe(404)
    const id = await rec(api)
    const t = tokenOf(await share(api, id))
    const full = await fetch(`${h.base}/r/${t}/file`)
    expect(full.status).toBe(200)
    expect(await full.text()).toBe('WEBM-ORIGINAL')
    expect(full.headers.get('content-disposition')).toMatch(/^inline/)
    const part = await fetch(`${h.base}/r/${t}/file`, { headers: { Range: 'bytes=0-3' } })
    expect(part.status).toBe(206)
    expect(await part.text()).toBe('WEBM')
    const dl = await fetch(`${h.base}/r/${t}/file?download=1`)
    expect(dl.headers.get('content-disposition')).toMatch(/^attachment/)
  })

  it('cannot reach other recordings or tracks', async () => {
    const { api } = await boot()
    const a = await rec(api, 'AAAA', 'song-0001', 'a.webm')
    const b = await rec(api, 'BBBB', 'song-0001', 'b.webm')
    await upload(api, Buffer.from('TRACKDATA'), { target: 'track', songId: 'song-0001', fileName: 't.mp3', mime: 'audio/mpeg' })
    const t = tokenOf(await share(api, a))
    expect(await (await fetch(`${h.base}/r/${t}/file`)).text()).toBe('AAAA')
    expect((await fetch(`${h.base}/r/${t}/track`)).status).toBe(404)
    expect((await fetch(`${h.base}/r/${t}/file?id=${b}`)).status).toBe(200)
    expect(await (await fetch(`${h.base}/r/${t}/file?id=${b}`)).text()).toBe('AAAA')
    expect((await fetch(`${h.base}/r/${t}/../../api/songs/song-0001/track`)).status).toBe(401)
    expect((await fetch(`${h.base}/api/songs/song-0001/track`)).status).toBe(401)
    expect((await fetch(`${h.base}/api/library`)).status).toBe(401)
    expect((await fetch(`${h.base}/r/${tokenOf(await share(api, a))}x/file`)).status).toBe(404)
  })

  it('redacts the token in the request log', async () => {
    const { api } = await boot()
    const id = await rec(api)
    const t = tokenOf(await share(api, id))
    await fetch(`${h.base}/r/${t}`)
    await fetch(`${h.base}/r/${t}/file`)
    const all = h.logs.join('\n')
    expect(all).not.toContain(t)
    expect(all).toContain('/r/***')
  })
})

describe('phone page and cookie session', () => {
  const login2 = (origin: string | undefined, password = PASSWORD) =>
    fetch(`${h.base}/session`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ password }) })
  const cookieOf = (r: Response) => r.headers.get('set-cookie')!.split(';')[0]

  it('serves static files with nosniff and CSP', async () => {
    await boot()
    for (const [p, type] of [['/', 'text/html'], ['/app.js', 'javascript'], ['/app.css', 'text/css']] as const) {
      const r = await fetch(h.base + p)
      expect(r.status).toBe(200)
      expect(r.headers.get('content-type')).toContain(type)
      expect(r.headers.get('x-content-type-options')).toBe('nosniff')
      expect(r.headers.get('content-security-policy')).toBe("default-src 'self'; media-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'")
    }
    expect(await (await fetch(h.base + '/')).text()).not.toMatch(/src="https?:/)
  })

  it('/session needs the PUBLIC_URL origin and the right password', async () => {
    await boot()
    expect((await login2('https://evil.test')).status).toBe(403)
    expect((await login2(undefined)).status).toBe(403)
    expect((await login2(ORIGIN, 'wrong')).status).toBe(401)
    const ok = await login2(ORIGIN)
    expect(ok.status).toBe(200)
    expect(ok.headers.get('set-cookie')).toMatch(/^mm_session=[A-Za-z0-9_-]{43}; HttpOnly; Secure; SameSite=Lax; Path=\/$/)
  })

  it('/m/* works with the cookie, 401 without, tracks/library stay Bearer-only', async () => {
    const { api } = await boot()
    const id = await rec(api)
    await upload(api, Buffer.from('X'), { target: 'cover', songId: 'song-0001', fileName: 'c.png', mime: 'image/png' })
    const cookie = cookieOf(await login2(ORIGIN))
    const c = { Cookie: cookie }
    expect((await fetch(`${h.base}/m/recordings`)).status).toBe(401)
    const list = await (await fetch(`${h.base}/m/recordings`, { headers: c })).json() as { recordings: { id: string; songTitle: string; songArtist: string }[]; songs: Record<string, unknown> }
    expect(list.recordings[0]).toMatchObject({ id, songTitle: 'Title', songArtist: 'Artist' })
    expect(list.songs['song-0001']).toMatchObject({ title: 'Title', artist: 'Artist', hasCover: true })
    expect(JSON.stringify(list)).not.toContain('track')
    const u = await (await fetch(`${h.base}/m/recordings/${id}/url`, { headers: c })).json() as { url: string }
    expect(u.url).toContain('/files/rec/')
    expect((await fetch(`${h.base}/m/recordings/${id}/url`)).status).toBe(401)
    expect((await fetch(`${h.base}/m/songs/song-0001/cover`, { headers: c })).status).toBe(200)
    expect((await fetch(`${h.base}/m/songs/song-0001/cover`)).status).toBe(401)
    for (const p of ['/api/library', '/api/songs/song-0001/track', '/api/songs/song-0001/cover', '/api/recordings', `/api/recordings/${id}/url`]) {
      expect((await fetch(h.base + p, { headers: c })).status).toBe(401)
    }
    expect((await fetch(`${h.base}/m/library`, { headers: c })).status).toBe(404)
    expect((await fetch(`${h.base}/m/songs/song-0001/track`, { headers: c })).status).toBe(404)
  })

  it('lists recordings of deleted songs without a live song entry', async () => {
    const { api, song } = await boot()
    await rec(api)
    await song('song-0001', 'Title', { updatedAt: '2026-03-01T00:00:00.000Z', deletedAt: '2026-03-01T00:00:00.000Z' })
    const cookie = cookieOf(await login2(ORIGIN))
    const list = await (await fetch(`${h.base}/m/recordings`, { headers: { Cookie: cookie } })).json() as { recordings: { songId: string }[]; songs: Record<string, unknown> }
    expect(list.recordings).toHaveLength(1)
    expect(list.songs['song-0001']).toBeUndefined()
  })

  it('state-changing /m/* needs a matching Origin; share/unshare/logout', async () => {
    const { api } = await boot()
    const id = await rec(api)
    const cookie = cookieOf(await login2(ORIGIN))
    const c = { Cookie: cookie }
    const post = (p: string, origin?: string, method = 'POST') => fetch(h.base + p, { method, headers: { ...c, ...(origin ? { Origin: origin } : {}) } })
    expect((await post(`/m/recordings/${id}/share`)).status).toBe(401)
    expect((await post(`/m/recordings/${id}/share`, 'https://evil.test')).status).toBe(403)
    const s = await post(`/m/recordings/${id}/share`, ORIGIN)
    expect(s.status).toBe(200)
    const { url } = await s.json() as { url: string }
    expect(await share(api, id)).toBe(url)
    expect((await post(`/m/recordings/${id}/share`, undefined, 'DELETE')).status).toBe(401)
    expect((await post(`/m/recordings/${id}/share`, 'https://evil.test', 'DELETE')).status).toBe(403)
    expect((await post(`/m/recordings/${id}/share`, ORIGIN, 'DELETE')).status).toBe(204)
    expect((await fetch(url.replace(ORIGIN, h.base))).status).toBe(404)
    expect((await post('/session/logout')).status).toBe(401)
    expect((await post('/session/logout', 'https://evil.test')).status).toBe(403)
    const out = await post('/session/logout', ORIGIN)
    expect(out.status).toBe(200)
    expect(out.headers.get('set-cookie')).toMatch(/^mm_session=;.*Max-Age=0/)
    expect((await fetch(`${h.base}/m/recordings`, { headers: c })).status).toBe(401)
  })
})
