import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '../src/config.ts'
import { openDb } from '../src/db.ts'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { connect } from 'node:net'
import { login, PASSWORD, start, type Harness } from './helpers.ts'

let h: Harness
afterEach(async () => { await h?.stop(); vi.restoreAllMocks() })

describe('config', () => {
  it('throws without OWNER_PASSWORD or SIGNING_SECRET', () => {
    expect(() => loadConfig({ SIGNING_SECRET: 'x' })).toThrow(/OWNER_PASSWORD/)
    expect(() => loadConfig({ OWNER_PASSWORD: 'x' })).toThrow(/SIGNING_SECRET/)
  })
  it('applies defaults', () => {
    const c = loadConfig({ OWNER_PASSWORD: 'a', SIGNING_SECRET: 'b' })
    expect(c.port).toBe(8120)
    expect(c.publicUrl).toBe('https://music.emiraksu.me')
    expect(c.maxUploadBytes).toBe(4294967296)
    expect(c.allowedOrigins).toContain('https://overflow-sudo.github.io')
  })
})

describe('db', () => {
  it('migrates (user_version >= 1, append-only) with WAL and all tables', () => {
    const db = openDb(mkdtempSync(join(tmpdir(), 'mm-db-')))
    expect(db.pragma('user_version', { simple: true })).toBeGreaterThanOrEqual(1)
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal')
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((r) => r.name)
    for (const t of ['tokens', 'songs', 'files', 'recordings', 'recording_tombstones', 'uploads', 'login_attempts']) expect(names).toContain(t)
    db.close()
  })
})

describe('http + auth', () => {
  it('health is 200 without auth', async () => {
    h = await start()
    const r = await fetch(h.base + '/health')
    expect(r.status).toBe(200)
  })

  it('wrong password 401, right password returns a base64url token stored hashed', async () => {
    h = await start()
    expect((await login(h, 'nope')).status).toBe(401)
    const r = await login(h, PASSWORD)
    expect(r.status).toBe(200)
    const { token } = await r.json() as { token: string }
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const rows = h.app.db.prepare('SELECT hash FROM tokens').all() as { hash: string }[]
    expect(rows).toHaveLength(1)
    expect(rows[0].hash).not.toContain(token)
    expect(rows[0].hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it('11th failed login in the window is 429', async () => {
    h = await start()
    for (let i = 0; i < 10; i++) expect((await login(h, 'bad')).status).toBe(401)
    expect((await login(h, 'bad')).status).toBe(429)
    expect((await login(h, PASSWORD)).status).toBe(429)
  })

  it('rate limit is per IP (X-Forwarded-For last entry)', async () => {
    h = await start()
    for (let i = 0; i < 10; i++) await login(h, 'bad', { 'X-Forwarded-For': '1.1.1.1' })
    expect((await login(h, 'bad', { 'X-Forwarded-For': '1.1.1.1' })).status).toBe(429)
    expect((await login(h, PASSWORD, { 'X-Forwarded-For': '2.2.2.2' })).status).toBe(200)
  })

  it('/api/library needs a valid Bearer token', async () => {
    h = await start()
    expect((await fetch(h.base + '/api/library')).status).toBe(401)
    expect((await fetch(h.base + '/api/library', { headers: { Authorization: 'Bearer wrong' } })).status).toBe(401)
    const { token } = await (await login(h, PASSWORD)).json() as { token: string }
    expect((await fetch(h.base + '/api/library', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200)
  })

  it('cookie mm_session works for GET only', async () => {
    h = await start()
    const { token } = await (await login(h, PASSWORD)).json() as { token: string }
    h.app.router.add('POST', '/api/ping', () => ({ ok: true }), { cookie: true })
    h.app.router.add('GET', '/api/cookie-probe', () => ({ ok: true }), { cookie: true })
    const headers = { Cookie: `mm_session=${token}` }
    expect((await fetch(h.base + '/api/cookie-probe', { headers })).status).toBe(200)
    expect((await fetch(h.base + '/api/ping', { method: 'POST', headers })).status).toBe(403)
  })

  it('CORS allows listed origins and rejects others', async () => {
    h = await start()
    const ok = 'https://overflow-sudo.github.io'
    const r = await fetch(h.base + '/health', { headers: { Origin: ok } })
    expect(r.headers.get('access-control-allow-origin')).toBe(ok)
    const bad = await fetch(h.base + '/health', { headers: { Origin: 'https://evil.example' } })
    expect(bad.headers.get('access-control-allow-origin')).toBeNull()
    const pre = await fetch(h.base + '/api/library', { method: 'OPTIONS', headers: { Origin: ok, 'Access-Control-Request-Method': 'GET' } })
    expect(pre.status).toBe(204)
    expect(pre.headers.get('access-control-allow-headers')).toBe('Authorization, Content-Type, X-File-Name')
    const preBad = await fetch(h.base + '/api/library', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } })
    expect(preBad.status).toBe(403)
    expect(preBad.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('oversize JSON is 413, bad JSON is 400, unknown route 404', async () => {
    h = await start()
    const big = await fetch(h.base + '/api/login', { method: 'POST', body: 'x'.repeat(1024 * 1024 + 1) })
    expect(big.status).toBe(413)
    const bad = await fetch(h.base + '/api/login', { method: 'POST', body: '{' })
    expect(bad.status).toBe(400)
    expect((await fetch(h.base + '/nope')).status).toBe(404)
  })

  it('never logs the token, password, or Authorization/cookie values', async () => {
    const spies = (['log', 'info', 'error', 'warn'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    h = await start()
    await login(h, 'wrong-password-xyz')
    const { token } = await (await login(h, PASSWORD)).json() as { token: string }
    await fetch(h.base + '/api/library', { headers: { Authorization: `Bearer ${token}`, Cookie: `mm_session=${token}` } })
    await fetch(h.base + '/api/library', { headers: { Authorization: 'Bearer bogus-token-abc' } })
    const all = h.logs.join('\n') + spies.flatMap((s) => s.mock.calls).map((c) => JSON.stringify(c)).join('\n')
    expect(h.logs.length).toBeGreaterThan(0)
    for (const secret of [token, PASSWORD, 'wrong-password-xyz', 'bogus-token-abc']) expect(all).not.toContain(secret)
  })

  it('logger redacts secret-named fields', async () => {
    const { consoleLogger } = await import('../src/log.ts')
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    consoleLogger.info('x', { authorization: 'Bearer abc', password: 'pw', ok: 1 })
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/abc|pw"/)
    expect(JSON.stringify(spy.mock.calls)).toContain('"ok":1')
  })

  const raw = (port: number, line: string) => new Promise<string>((resolve) => {
    const sock = connect(port, '127.0.0.1', () => sock.write(`${line}\r\nHost: x\r\nConnection: close\r\n\r\n`))
    let out = ''
    sock.on('data', (d) => { out += d })
    sock.on('close', () => resolve(out))
  })

  it('malformed request target is a 4xx and does not crash the server', async () => {
    h = await start()
    const port = Number(new URL(h.base).port)
    expect(await raw(port, 'GET //[ HTTP/1.1')).toMatch(/^HTTP\/1.1 40[04]/)
    expect((await fetch(h.base + '/health')).status).toBe(200)
  })

  it('//api/library is a distinct path, not host "api"', async () => {
    h = await start()
    const port = Number(new URL(h.base).port)
    expect(await raw(port, 'GET //api/library HTTP/1.1')).toMatch(/^HTTP\/1.1 404/)
  })

  it('CORS headers are set even when the handler writes its own response', async () => {
    h = await start()
    h.app.router.add('GET', '/stream', ({ res }) => { res.writeHead(200); res.end('data') }, { auth: false })
    const ok = 'http://localhost:5173'
    const r = await fetch(h.base + '/stream', { headers: { Origin: ok } })
    expect(await r.text()).toBe('data')
    expect(r.headers.get('access-control-allow-origin')).toBe(ok)
  })

  it('declared oversize Content-Length is 413 early; HEAD works on GET routes', async () => {
    h = await start()
    const port = Number(new URL(h.base).port)
    expect(await raw(port, 'POST /api/login HTTP/1.1\r\nContent-Length: 9999999')).toMatch(/^HTTP\/1.1 413/)
    expect((await fetch(h.base + '/health', { method: 'HEAD' })).status).toBe(200)
  })
})
