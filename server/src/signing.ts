import { createHmac, timingSafeEqual } from 'node:crypto'

export const SIGNED_URL_TTL_SEC = 3600

/** Inline: HMAC(id.exp) as in the global constraints; download adds a '.d' suffix so the two never interchange. */
function mac(secret: string, id: string, exp: number, download: boolean): string {
  return createHmac('sha256', secret).update(`${id}.${exp}${download ? '.d' : ''}`).digest('hex')
}

export function sign(secret: string, id: string, exp: number, download = false): string {
  return mac(secret, id, exp, download)
}

/** `expRaw`/`sig` come from the query string (untrusted). `nowSec` is injectable. */
export function verify(secret: string, id: string, expRaw: unknown, sig: unknown, download: boolean, nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (typeof expRaw !== 'string' || !/^\d{1,12}$/.test(expRaw)) return false
  if (typeof sig !== 'string' || !/^[0-9a-f]{64}$/.test(sig)) return false
  const exp = Number(expRaw)
  const good = Buffer.from(mac(secret, id, exp, download), 'hex')
  const got = Buffer.from(sig, 'hex')
  if (good.length !== got.length || !timingSafeEqual(good, got)) return false
  return exp > nowSec
}
