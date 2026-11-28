import { HttpError } from './http.ts'

export const ID_RE = /^[A-Za-z0-9_-]{8,64}$/

/** Ids that may become path segments; anything else is rejected before touching the filesystem. */
export function validId(value: unknown, what = 'id'): string {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new HttpError(400, `Invalid ${what}`)
  return value
}
