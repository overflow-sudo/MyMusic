import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { LoginResponse } from '../../shared/api.ts'
import type { Config } from './config.ts'
import type { Db } from './db.ts'
import { HttpError } from './http.ts'

export const LOGIN_WINDOW_MS = 15 * 60 * 1000
export const LOGIN_MAX_FAILURES = 10
export const COOKIE_NAME = 'mm_session'

export const sha256 = (s: string): Buffer => createHash('sha256').update(s).digest()
export const hashToken = (token: string): string => sha256(token).toString('hex')

export function passwordMatches(given: string, expected: string): boolean {
  return timingSafeEqual(sha256(given), sha256(expected))
}

export function sessionCookie(token: string): string {
  return `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/`
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
}

export class Auth {
  constructor(private db: Db, private config: Config, private now: () => number = Date.now) {}

  login(ip: string, password: unknown): LoginResponse {
    const now = this.now()
    this.db.prepare('DELETE FROM login_attempts WHERE at < ?').run(now - LOGIN_WINDOW_MS)
    const { n } = this.db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND at >= ?')
      .get(ip, now - LOGIN_WINDOW_MS) as { n: number }
    if (n >= LOGIN_MAX_FAILURES) throw new HttpError(429, 'Too many attempts', { 'Retry-After': '900' })
    if (typeof password !== 'string' || !passwordMatches(password, this.config.ownerPassword)) {
      this.db.prepare('INSERT INTO login_attempts (ip, at) VALUES (?, ?)').run(ip, now)
      throw new HttpError(401, 'Wrong password')
    }
    this.db.prepare('DELETE FROM login_attempts WHERE ip = ?').run(ip)
    const token = randomBytes(32).toString('base64url')
    this.db.prepare('INSERT INTO tokens (hash, created_at) VALUES (?, ?)')
      .run(hashToken(token), new Date(now).toISOString())
    return { token }
  }

  private tokenValid(token: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM tokens WHERE hash = ?').get(hashToken(token))
  }

  /** CSRF guard for cookie-authenticated requests: Origin must be exactly the PUBLIC_URL origin. */
  originOk(req: IncomingMessage): boolean {
    try { return req.headers.origin === new URL(this.config.publicUrl).origin } catch { return false }
  }

  cookieToken(req: IncomingMessage): string | undefined {
    return req.headers.cookie?.split(';').map((c) => c.trim())
      .find((c) => c.startsWith(COOKIE_NAME + '='))?.slice(COOKIE_NAME.length + 1)
  }

  revoke(token: string): void {
    this.db.prepare('DELETE FROM tokens WHERE hash = ?').run(hashToken(token))
  }

  /** Bearer for everything; the mm_session cookie only on routes marked `cookie: true` (phone page), and for state-changing methods only with a matching Origin. */
  authenticate = (req: IncomingMessage, allowCookie = false): void => {
    const header = req.headers.authorization
    const bearer = header?.match(/^Bearer\s+(\S+)$/i)?.[1]
    if (bearer && this.tokenValid(bearer)) return
    if (!bearer && allowCookie) {
      const cookie = this.cookieToken(req)
      if (cookie && this.tokenValid(cookie)) {
        if (req.method === 'GET' || req.method === 'HEAD' || this.originOk(req)) return
        throw new HttpError(403, 'Origin header must match the site origin')
      }
    }
    throw new HttpError(401, 'Unauthorized', { 'WWW-Authenticate': 'Bearer' })
  }
}
