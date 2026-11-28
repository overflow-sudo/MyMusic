import { randomBytes } from 'node:crypto'
import type { Config } from './config.ts'
import type { Db } from './db.ts'
import type { Files } from './files.ts'
import { HttpError, type Ctx, type Router } from './http.ts'
import type { Recordings } from './recordings.ts'
import { validId } from './ids.ts'

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/
const REC_ID_RE = /^[0-9a-f]{32}$/
export const SHARE_CSP = "default-src 'self'; img-src 'self'; media-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"

interface ShareRow { id: string; song_id: string; kind: 'video' | 'ses'; song_title: string; song_artist: string }

const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' }
const esc = (s: string): string => s.replace(/[&<>"'`]/g, (c) => ENT[c])

export class Shares {
  constructor(private db: Db, private config: Config, private files: Files, private recordings: Recordings) {}

  private exists(id: string): boolean {
    if (!REC_ID_RE.test(id)) throw new HttpError(400, 'Invalid recording id')
    return !!this.db.prepare('SELECT 1 FROM recordings WHERE id = ?').get(id)
  }

  /** Returns the existing token's url or creates one (32 random bytes, base64url). */
  create(id: string): { url: string } {
    if (!this.exists(id)) throw new HttpError(404, 'Unknown recording')
    const cur = this.db.prepare('SELECT share_token AS t FROM recordings WHERE id = ?').get(id) as { t: string | null }
    let token = cur.t
    if (!token) {
      token = randomBytes(32).toString('base64url')
      this.db.prepare('UPDATE recordings SET share_token = ? WHERE id = ? AND share_token IS NULL').run(token, id)
      token = (this.db.prepare('SELECT share_token AS t FROM recordings WHERE id = ?').get(id) as { t: string }).t
    }
    return { url: `${this.config.publicUrl}/r/${token}` }
  }

  revoke(id: string): void {
    if (!REC_ID_RE.test(id)) throw new HttpError(400, 'Invalid recording id')
    this.db.prepare('UPDATE recordings SET share_token = NULL WHERE id = ?').run(id)
  }

  /** The one recording behind a token, or 404. */
  private byToken(token: string): ShareRow {
    const row = TOKEN_RE.test(token)
      ? this.db.prepare('SELECT id, song_id, kind, song_title, song_artist FROM recordings WHERE share_token = ?').get(token) as ShareRow | undefined
      : undefined
    if (!row) throw new HttpError(404, 'Not found')
    return row
  }

  private html(ctx: Ctx, status: number, body: string): void {
    const buf = Buffer.from(body, 'utf8')
    ctx.res.writeHead(status, {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Length': buf.length,
      'Content-Security-Policy': SHARE_CSP,
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Robots-Tag': 'noindex',
      'Cache-Control': 'private, no-store',
    })
    ctx.res.end(ctx.req.method === 'HEAD' ? undefined : buf)
  }

  private page(title: string, inner: string): string {
    return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer">
<title>${esc(title)}</title><link rel="stylesheet" href="/app.css"></head>
<body class="share"><main class="share-card">${inner}</main></body></html>`
  }

  renderPage(ctx: Ctx): void {
    let row: ShareRow
    try { row = this.byToken(ctx.params.token) } catch {
      return this.html(ctx, 404, this.page('Bulunamadı', '<h1>Bulunamadı</h1><p class="dim">Bu bağlantı geçersiz ya da kaldırılmış.</p>'))
    }
    const t = ctx.params.token
    const cover = this.files.row(row.song_id, 'cover') ? `<img class="cover" src="/r/${t}/cover" alt="" width="160" height="160">` : ''
    const src = `/r/${t}/file`
    const player = row.kind === 'video'
      ? `<video controls playsinline preload="metadata" src="${src}"></video>`
      : `<audio controls preload="metadata" src="${src}"></audio>`
    const title = row.song_title || 'Kayıt'
    this.html(ctx, 200, this.page(title, `${cover}<h1>${esc(title)}</h1><p class="dim">${esc(row.song_artist)}</p>${player}
<p><a class="btn" href="${src}?download=1" download>İndir</a></p>`))
  }

  async serveFile(ctx: Ctx): Promise<void> {
    const row = this.byToken(ctx.params.token)
    await this.recordings.serveRow(ctx, row.id, ctx.url.searchParams.get('download') === '1')
  }

  async serveCover(ctx: Ctx): Promise<void> {
    const row = this.byToken(ctx.params.token)
    await this.files.serve({ ...ctx, params: { id: validId(row.song_id, 'song id') } }, 'cover')
  }
}

export function registerShareRoutes(router: Router, shares: Shares): void {
  router.add('POST', '/api/recordings/:id/share', (ctx) => shares.create(ctx.params.id))
  router.add('DELETE', '/api/recordings/:id/share', (ctx) => { shares.revoke(ctx.params.id); ctx.res.writeHead(204); ctx.res.end() })
  router.add('GET', '/r/:token', (ctx) => shares.renderPage(ctx), { auth: false })
  router.add('GET', '/r/:token/file', (ctx) => shares.serveFile(ctx), { auth: false })
  router.add('GET', '/r/:token/cover', (ctx) => shares.serveCover(ctx), { auth: false })
}
