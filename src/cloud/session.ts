import { useSyncExternalStore } from 'react'
export const DEFAULT_BASE_URL = 'https://music.emiraksu.me'
const KEY = 'mm.cloud'

export interface Session { baseUrl: string; token: string }

const listeners = new Set<() => void>()
let generation = 0
/** Bumps whenever the session is set or cleared; in-flight requests of an older generation must not touch status. */
export const sessionGeneration = (): number => generation
const emit = () => { generation++; for (const l of [...listeners]) l() }

/** Trims, strips trailing slashes; https only (http allowed for localhost). Null when invalid. */
export function normalizeBaseUrl(input: string): string | null {
  const s = input.trim().replace(/\/+$/, '')
  let u: URL
  try { u = new URL(s) } catch { return null }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]'
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null
  if (!u.hostname || u.username || u.password || u.search || u.hash || u.pathname !== '/') return null
  return u.origin
}

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as Partial<Session> | null
    if (!v || typeof v.token !== 'string' || !v.token || typeof v.baseUrl !== 'string') return null
    const baseUrl = normalizeBaseUrl(v.baseUrl)
    return baseUrl ? { baseUrl, token: v.token } : null
  } catch { return null }
}

export function setSession(s: Session): void {
  const baseUrl = normalizeBaseUrl(s.baseUrl)
  if (!baseUrl) throw new Error('Invalid server address')
  try { localStorage.setItem(KEY, JSON.stringify({ baseUrl, token: s.token })) } catch { /* storage unavailable */ }
  emit()
}

export function clearSession(): void {
  try { localStorage.removeItem(KEY) } catch { /* storage unavailable */ }
  emit()
}

export function onSessionChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** True while a cloud session (token) is saved; re-renders on login/logout. */
export function useHasSession(): boolean {
  return useSyncExternalStore(onSessionChange, () => getSession() !== null)
}
