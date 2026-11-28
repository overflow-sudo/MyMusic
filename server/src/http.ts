import type { IncomingMessage, ServerResponse } from 'node:http'
import type { ApiError } from '../../shared/api.ts'
import type { Logger } from './log.ts'

export class HttpError extends Error {
  constructor(public status: number, message: string, public headers: Record<string, string> = {}) {
    super(message)
  }
}

export interface Ctx {
  req: IncomingMessage
  res: ServerResponse
  url: URL
  params: Record<string, string>
  ip: string
  /** Parsed JSON body (only for routes with json !== false). */
  body: unknown
}

export interface RouteOptions {
  /** Require a valid token. Default true. */
  auth?: boolean
  /** Parse body as JSON (max 1 MiB). Default true; set false for streaming routes. */
  json?: boolean
}

type Handler = (ctx: Ctx) => unknown | Promise<unknown>
interface Route { method: string; parts: string[]; handler: Handler; auth: boolean; json: boolean }

export const JSON_MAX_BYTES = 1024 * 1024
const ALLOW_HEADERS = 'Authorization, Content-Type, X-File-Name'

export function sendJson(res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}): void {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    ...headers,
  })
  res.end(body)
}

export async function readJson(req: IncomingMessage, max = JSON_MAX_BYTES): Promise<unknown> {
  const declared = Number(req.headers['content-length'])
  if (Number.isFinite(declared) && declared > max) throw new HttpError(413, 'Body too large')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > max) throw new HttpError(413, 'Body too large')
    chunks.push(chunk as Buffer)
  }
  if (size === 0) return undefined
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new HttpError(400, 'Invalid JSON') }
}

/** Client IP: Caddy appends the real client as the last X-Forwarded-For entry. */
export function clientIp(req: IncomingMessage): string {
  const xff = req.headers['x-forwarded-for']
  const last = (Array.isArray(xff) ? xff.join(',') : xff)?.split(',').pop()?.trim()
  return last || req.socket.remoteAddress || 'unknown'
}

export class Router {
  private routes: Route[] = []
  constructor(
    private opts: {
      allowedOrigins: string[]
      logger: Logger
      /** Throws HttpError(401) when the request is not authorised. */
      authenticate: (req: IncomingMessage) => void
    },
  ) {}

  add(method: string, path: string, handler: Handler, o: RouteOptions = {}): void {
    this.routes.push({
      method, parts: path.split('/').filter(Boolean), handler,
      auth: o.auth !== false, json: o.json !== false,
    })
  }

  private match(method: string, pathname: string): { route: Route; params: Record<string, string> } | 'method' | null {
    // Strict split: '//api/x' must not collapse onto '/api/x'.
    const segs = pathname.split('/').slice(1)
    let pathMatched = false
    for (const route of this.routes) {
      if (route.parts.length !== segs.length) continue
      const params: Record<string, string> = {}
      let ok = true
      for (let i = 0; i < segs.length && ok; i++) {
        const p = route.parts[i]
        if (p.startsWith(':')) {
          try { params[p.slice(1)] = decodeURIComponent(segs[i]) } catch { ok = false }
        } else if (p !== segs[i]) ok = false
      }
      if (!ok) continue
      pathMatched = true
      if (route.method === method || (method === 'HEAD' && route.method === 'GET')) return { route, params }
    }
    return pathMatched ? 'method' : null
  }

  private cors(req: IncomingMessage): Record<string, string> | null {
    const origin = req.headers.origin
    if (!origin) return {}
    if (!this.opts.allowedOrigins.includes(origin)) return null
    return {
      'Access-Control-Allow-Origin': origin,
      Vary: 'Origin',
      'Access-Control-Allow-Headers': ALLOW_HEADERS,
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Expose-Headers': 'Retry-After',
      'Access-Control-Max-Age': '600',
    }
  }

  handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const method = req.method ?? 'GET'
    const cors = this.cors(req)
    let status = 500
    let logPath = '?'
    try {
      // Never let URL treat a leading '//' as an authority: prefix the path ourselves.
      const target = req.url ?? '/'
      if (!target.startsWith('/')) throw new HttpError(400, 'Bad request target')
      let url: URL
      try { url = new URL('http://local' + target) } catch { throw new HttpError(400, 'Bad request target') }
      logPath = url.pathname
      for (const [k, v] of Object.entries(cors ?? {})) res.setHeader(k, v)
      if (method === 'OPTIONS') {
        if (!cors || !req.headers.origin) throw new HttpError(403, 'Origin not allowed')
        status = 204
        res.writeHead(204, cors)
        res.end()
        return
      }
      const m = this.match(method, url.pathname)
      if (m === null) throw new HttpError(404, 'Not found')
      if (m === 'method') throw new HttpError(405, 'Method not allowed')
      if (m.route.auth) this.opts.authenticate(req)
      const body = m.route.json && method !== 'GET' && method !== 'HEAD' ? await readJson(req) : undefined
      const result = await m.route.handler({ req, res, url, params: m.params, ip: clientIp(req), body })
      if (!res.headersSent) {
        status = 200
        sendJson(res, 200, result ?? { ok: true })
      } else status = res.statusCode
    } catch (e) {
      if (res.headersSent) { res.destroy(); return }
      const err = e instanceof HttpError ? e : null
      if (!err) this.opts.logger.error('unhandled error', { message: e instanceof Error ? e.message : String(e) })
      status = err?.status ?? 500
      const payload: ApiError = { error: err?.message ?? 'Internal error' }
      sendJson(res, status, payload, { ...(cors ?? {}), ...(err?.headers ?? {}) })
    } finally {
      this.opts.logger.info('request', { method, path: logPath, status })
    }
  }
}
