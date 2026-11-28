import { readFileSync } from 'node:fs'
import type { Auth } from './auth.ts'
import { clearSessionCookie, sessionCookie } from './auth.ts'
import type { Files } from './files.ts'
import { HttpError, sendJson, type Ctx, type Router } from './http.ts'
import type { Library } from './library.ts'
import type { Recordings } from './recordings.ts'
import type { Shares } from './share.ts'

const PAGE_CSP = "default-src 'self'; media-src 'self'; img-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'"
const STATIC: [string, string, string][] = [
  ['/', 'index.html', 'text/html; charset=utf-8'],
  ['/app.js', 'app.js', 'text/javascript; charset=utf-8'],
  ['/app.css', 'app.css', 'text/css; charset=utf-8'],
]

export interface PhoneSong { id: string; title: string; artist: string; hasCover: boolean }

export function registerPageRoutes(router: Router, deps: { auth: Auth; recordings: Recordings; library: Library; files: Files; shares: Shares }): void {
  const { auth, recordings, library, files, shares } = deps
  const publicDir = new URL('../public/', import.meta.url)

  for (const [path, file, type] of STATIC) {
    router.add('GET', path, (ctx) => {
      const body = readFileSync(new URL(file, publicDir))
      ctx.res.writeHead(200, {
        'Content-Type': type, 'Content-Length': body.length, 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': PAGE_CSP, 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-cache',
      })
      ctx.res.end(ctx.req.method === 'HEAD' ? undefined : body)
    }, { auth: false })
  }

  router.add('POST', '/session', (ctx) => {
    if (!auth.originOk(ctx.req)) throw new HttpError(403, 'Bad origin')
    const { token } = auth.login(ctx.ip, (ctx.body as { password?: unknown } | undefined)?.password)
    sendJson(ctx.res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(token), 'Cache-Control': 'no-store' })
  }, { auth: false })

  router.add('POST', '/session/logout', (ctx: Ctx) => {
    const token = auth.cookieToken(ctx.req)
    if (token) auth.revoke(token)
    sendJson(ctx.res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() })
  }, { cookie: true })

  // Phone API: recordings and cover only. Tracks and the library JSON are never reachable by cookie.
  router.add('GET', '/m/recordings', () => {
    const items = recordings.list()
    const songs: Record<string, PhoneSong> = {}
    for (const s of library.list()) {
      if (s.deletedAt) continue
      songs[s.id] = { id: s.id, title: s.title, artist: s.artist, hasCover: !!files.row(s.id, 'cover') }
    }
    return { recordings: items.filter((r) => !('deleted' in r)), songs }
  }, { cookie: true })
  router.add('GET', '/m/recordings/:id/url', (ctx) => recordings.signedUrl(ctx.params.id, ctx.url.searchParams.get('download') === '1'), { cookie: true })
  router.add('POST', '/m/recordings/:id/share', (ctx) => shares.create(ctx.params.id), { cookie: true })
  router.add('DELETE', '/m/recordings/:id/share', (ctx) => { shares.revoke(ctx.params.id); ctx.res.writeHead(204); ctx.res.end() }, { cookie: true })
  router.add('GET', '/m/songs/:id/cover', (ctx) => files.serve(ctx, 'cover'), { cookie: true })
}
