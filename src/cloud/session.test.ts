import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_BASE_URL, clearSession, getSession, normalizeBaseUrl, onSessionChange, setSession } from './session'

afterEach(() => localStorage.clear())

describe('normalizeBaseUrl', () => {
  it('strips trailing slashes and keeps https', () => {
    expect(normalizeBaseUrl('https://music.emiraksu.me/')).toBe('https://music.emiraksu.me')
    expect(normalizeBaseUrl('  https://a.example///  ')).toBe('https://a.example')
  })
  it('allows http only for localhost', () => {
    expect(normalizeBaseUrl('http://localhost:8120/')).toBe('http://localhost:8120')
    expect(normalizeBaseUrl('http://example.com')).toBeNull()
    expect(normalizeBaseUrl('music.emiraksu.me')).toBeNull()
    expect(normalizeBaseUrl('')).toBeNull()
    expect(normalizeBaseUrl('https://')).toBeNull()
  })
})

describe('session store', () => {
  it('is null when nothing stored; set/get/clear round trip under mm.cloud', () => {
    expect(getSession()).toBeNull()
    setSession({ baseUrl: 'https://x.example/', token: 'tok' })
    expect(getSession()).toEqual({ baseUrl: 'https://x.example', token: 'tok' })
    expect(JSON.parse(localStorage.getItem('mm.cloud')!)).toEqual({ baseUrl: 'https://x.example', token: 'tok' })
    clearSession()
    expect(getSession()).toBeNull()
    expect(localStorage.getItem('mm.cloud')).toBeNull()
  })
  it('ignores corrupt storage and notifies listeners', () => {
    localStorage.setItem('mm.cloud', '{oops')
    expect(getSession()).toBeNull()
    const fn = vi.fn()
    const off = onSessionChange(fn)
    setSession({ baseUrl: DEFAULT_BASE_URL, token: 't' })
    clearSession()
    off()
    setSession({ baseUrl: DEFAULT_BASE_URL, token: 't' })
    expect(fn).toHaveBeenCalledTimes(2)
  })
  it('rejects an invalid base url', () => {
    expect(() => setSession({ baseUrl: 'http://evil.example', token: 't' })).toThrow()
  })
})

it('allows http on IPv6 loopback', () => {
  expect(normalizeBaseUrl('http://[::1]:8120/')).toBe('http://[::1]:8120')
})
