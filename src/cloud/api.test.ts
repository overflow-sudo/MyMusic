import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudError, createApi } from './api'
import { getCloudStatus, resetCloudStatus, setCloudStatus } from './status'

const session = { baseUrl: 'https://s.example', token: 'tok123' }
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })

beforeEach(() => { resetCloudStatus(); setCloudStatus('connected') })
afterEach(() => { vi.useRealTimers() })

describe('createApi', () => {
  it('login posts the password and returns the token; no auth header', async () => {
    const f = vi.fn(async () => json({ token: 'newtok' }))
    const api = createApi({ baseUrl: 'https://s.example', token: null }, f)
    expect(await api.login('pw')).toEqual({ token: 'newtok' })
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://s.example/api/login')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ password: 'pw' })
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('sends the token only in the Authorization header', async () => {
    const f = vi.fn(async () => json({ songs: [] }))
    await createApi(session, f).getLibrary()
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://s.example/api/library')
    expect(url).not.toContain('tok123')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok123')
  })

  it('401 -> auth error and status needs-login; token kept', async () => {
    localStorage.setItem('mm.cloud', JSON.stringify(session))
    const api = createApi(session, async () => json({ error: 'Unauthorized' }, { status: 401 }))
    await expect(api.getLibrary()).rejects.toMatchObject({ kind: 'auth', status: 401 })
    expect(getCloudStatus().state).toBe('needs-login')
    expect(JSON.parse(localStorage.getItem('mm.cloud')!).token).toBe('tok123')
    localStorage.clear()
  })

  it('login 401 is an auth error but does not flip status to needs-login', async () => {
    setCloudStatus('off')
    const api = createApi({ baseUrl: 'https://s.example', token: null }, async () => json({ error: 'Wrong password' }, { status: 401 }))
    await expect(api.login('x')).rejects.toMatchObject({ kind: 'auth' })
    expect(getCloudStatus().state).toBe('off')
  })

  it('429 -> rate with retryAfter seconds', async () => {
    const api = createApi(session, async () => json({ error: 'x' }, { status: 429, headers: { 'Retry-After': '900' } }))
    await expect(api.login('x')).rejects.toMatchObject({ kind: 'rate', retryAfter: 900 })
  })

  it('fetch TypeError -> offline error and status offline', async () => {
    const api = createApi(session, async () => { throw new TypeError('Failed to fetch') })
    const e = await api.health().catch((x) => x)
    expect(e).toBeInstanceOf(CloudError)
    expect(e.kind).toBe('offline')
    expect(getCloudStatus().state).toBe('offline')
  })

  it('a later success clears offline back to connected', async () => {
    setCloudStatus('offline')
    await createApi(session, async () => json({ ok: true })).health()
    expect(getCloudStatus().state).toBe('connected')
  })

  it('maps 409/410/5xx/4xx', async () => {
    const kinds = async (status: number) =>
      (await createApi(session, async () => json({ error: 'e' }, { status })).getLibrary().catch((x) => x)).kind
    expect(await kinds(409)).toBe('conflict')
    expect(await kinds(410)).toBe('gone')
    expect(await kinds(404)).toBe('gone')
    expect(await kinds(503)).toBe('server')
    expect(await kinds(400)).toBe('client')
  })

  it('times out JSON calls after 20 s as offline', async () => {
    vi.useFakeTimers()
    const f = vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_res, rej) => {
      init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
    }))
    const p = createApi(session, f as unknown as typeof fetch).getLibrary().catch((x) => x)
    await vi.advanceTimersByTimeAsync(20_001)
    expect((await p).kind).toBe('offline')
  })

  it('song / recording endpoints use the right verbs and paths', async () => {
    const f = vi.fn(async (_u: string, _i: RequestInit) => json({ url: 'https://s.example/x', id: 'a' }))
    const api = createApi(session, f as unknown as typeof fetch)
    await api.putSong({ id: 'sid', title: 't', artist: 'a', updatedAt: '2026-01-01T00:00:00.000Z' })
    await api.getRecordings()
    await api.getRecordingUrl('r1', { download: true })
    await api.getRecordingUrl('r1')
    await api.deleteRecording('r1')
    await api.shareRecording('r1')
    await api.unshareRecording('r1')
    const calls = f.mock.calls.map(([u, i]) => `${i.method} ${u}`)
    expect(calls).toEqual([
      'PUT https://s.example/api/songs/sid',
      'GET https://s.example/api/recordings',
      'GET https://s.example/api/recordings/r1/url?download=1',
      'GET https://s.example/api/recordings/r1/url',
      'DELETE https://s.example/api/recordings/r1',
      'POST https://s.example/api/recordings/r1/share',
      'DELETE https://s.example/api/recordings/r1/share',
    ])
  })

  it('204 responses (unshare) resolve; getFile returns blob and hash; deleteFile hits the kind path', async () => {
    const f = vi.fn(async (u: string, i: RequestInit) =>
      i.method === 'DELETE' && u.endsWith('/share') ? new Response(null, { status: 204 })
        : i.method === 'GET' ? new Response('abc', { headers: { 'X-Content-SHA256': 'deadbeef' } }) : json({ ok: true }))
    const api = createApi(session, f as unknown as typeof fetch)
    await expect(api.unshareRecording('r')).resolves.toBeUndefined()
    const file = await api.getFile('s1', 'cover')
    expect(file.hash).toBe('deadbeef')
    expect(await file.blob.text()).toBe('abc')
    await api.deleteFile('s1', 'track')
    expect(f.mock.calls.at(-1)![0]).toBe('https://s.example/api/songs/s1/track')
  })
})

describe('upload primitives', () => {
  const mk = (f: unknown) => createApi(session, f as typeof fetch)
  it('createUpload / putPart / completeUpload / abortUpload requests', async () => {
    const f = vi.fn(async (_u: string, _i: RequestInit) => json({ uploadId: 'u', size: 3, id: 'x' }))
    const api = mk(f)
    await api.createUpload()
    const blob = new Blob(['abc'])
    await api.putPart('u', 0, blob)
    await api.putPart('u', 2, blob)
    await api.completeUpload('u', { target: 'track', songId: 's' })
    await api.abortUpload('u')
    const c = f.mock.calls
    expect(c.map(([u, i]) => `${i.method} ${u}`)).toEqual([
      'POST https://s.example/api/uploads', 'PUT https://s.example/api/uploads/u/0', 'PUT https://s.example/api/uploads/u/2',
      'POST https://s.example/api/uploads/u/complete', 'DELETE https://s.example/api/uploads/u',
    ])
    for (const [, i] of c) expect((i.headers as Record<string, string>).Authorization).toBe('Bearer tok123')
    expect(c[1][1].body).toBe(blob)
    expect((c[3][1].headers as Record<string, string>)['Content-Type']).toBe('application/json')
    expect(JSON.parse(c[3][1].body as string)).toEqual({ target: 'track', songId: 's' })
  })

  const hang = () => vi.fn((_u: string, init: RequestInit) => new Promise<Response>((_r, rej) => {
    init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
  }))

  it('part times out after 5 min (offline), but not before', async () => {
    vi.useFakeTimers()
    const p = mk(hang()).putPart('u', 0, new Blob(['a'])).catch((x) => x)
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 100)
    let settled = false
    void p.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(200)
    expect((await p).kind).toBe('offline')
  })

  it('complete tolerates 20 s, times out at 10 min with phase complete', async () => {
    vi.useFakeTimers()
    const p = mk(hang()).completeUpload('u', { target: 'recording' }).catch((x) => x)
    await vi.advanceTimersByTimeAsync(60_000)
    let settled = false
    void p.then(() => { settled = true })
    await vi.advanceTimersByTimeAsync(0)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    const e = await p
    expect(e.kind).toBe('offline')
    expect(e.phase).toBe('complete')
  })

  it('caller abort during a part -> client error, status untouched', async () => {
    const ac = new AbortController()
    const p = mk(hang()).putPart('u', 0, new Blob(['a']), { signal: ac.signal }).catch((x) => x)
    ac.abort()
    expect((await p).kind).toBe('client')
    expect(getCloudStatus().state).toBe('connected')
  })
})

describe('body reads', () => {
  it('getFile times out while the body stalls', async () => {
    vi.useFakeTimers()
    const f = vi.fn((_u: string, init: RequestInit) => {
      const body = new ReadableStream({ start(c) { init.signal!.addEventListener('abort', () => c.error(new TypeError('terminated'))) } })
      return Promise.resolve(new Response(body))
    })
    const p = createApi(session, f as unknown as typeof fetch).getFile('s', 'track').catch((x) => x)
    await vi.advanceTimersByTimeAsync(10 * 60_000 + 100)
    expect((await p).kind).toBe('offline')
    expect(getCloudStatus().state).toBe('offline')
  })
  it('mid-body failure on JSON is offline, not server', async () => {
    const body = new ReadableStream({ start(c) { c.error(new TypeError('reset')) } })
    const e = await createApi(session, async () => new Response(body)).getLibrary().catch((x) => x)
    expect(e.kind).toBe('offline')
  })
  it('caller abort stops a stalled download', async () => {
    const ac = new AbortController()
    const f = (_u: string, init: RequestInit) => {
      const body = new ReadableStream({ start(c) { init.signal!.addEventListener('abort', () => c.error(new TypeError('x'))) } })
      return Promise.resolve(new Response(body))
    }
    const p = createApi(session, f as unknown as typeof fetch).getFile('s', 'cover', { signal: ac.signal }).catch((x) => x)
    await new Promise((r) => setTimeout(r, 5))
    ac.abort()
    expect((await p).kind).toBe('client')
  })
})

describe('misc', () => {
  it('login with an empty token is a server error', async () => {
    const e = await createApi({ baseUrl: 'https://s.example', token: null }, async () => json({ token: '' })).login('x').catch((x) => x)
    expect(e.kind).toBe('server')
  })
  it('status updates from a replaced session are ignored', async () => {
    const { setSession } = await import('./session')
    const api = createApi(session, async () => json({}, { status: 401 }))
    setSession({ baseUrl: 'https://other.example', token: 'n' })
    await api.getLibrary().catch(() => undefined)
    expect(getCloudStatus().state).toBe('connected')
    localStorage.clear()
  })
  it('parses an HTTP-date Retry-After', async () => {
    const d = new Date(Date.now() + 120_000).toUTCString()
    const e = await createApi(session, async () => json({}, { status: 429, headers: { 'Retry-After': d } })).login('x').catch((x) => x)
    expect(e.retryAfter).toBeGreaterThan(100)
    expect(e.retryAfter).toBeLessThanOrEqual(120)
  })
})
