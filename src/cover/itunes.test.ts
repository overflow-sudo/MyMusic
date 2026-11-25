import { afterEach, describe, expect, it, vi } from 'vitest'
import { itunesUrl, jsonp, searchCover } from './itunes'

const okJson = (body: unknown) => ({ ok: true, json: async () => body }) as Response

describe('itunesUrl', () => {
  it('builds the exact search URL', () => {
    expect(itunesUrl('Wonderwall', 'Oasis')).toBe(
      'https://itunes.apple.com/search?term=Wonderwall%20Oasis&entity=song&limit=1&country=TR',
    )
  })
})

describe('searchCover', () => {
  it('upscales artwork to 600x600', async () => {
    const f = vi.fn(async () => okJson({ results: [{ artworkUrl100: 'https://x/100x100bb.jpg' }] }))
    expect(await searchCover('a', 'b', { fetch: f as unknown as typeof fetch })).toEqual({
      artworkUrl: 'https://x/600x600bb.jpg',
    })
  })
  it('falls back to jsonp when fetch throws', async () => {
    const f = vi.fn(async () => { throw new TypeError('CORS') })
    const j = vi.fn(async () => ({ results: [{ artworkUrl100: 'https://y/100x100bb.jpg' }] }))
    const r = await searchCover('a', 'b', { fetch: f as unknown as typeof fetch, jsonp: j })
    expect(r).toEqual({ artworkUrl: 'https://y/600x600bb.jpg' })
    expect(j).toHaveBeenCalledWith(itunesUrl('a', 'b'))
  })
  it('returns null on non-OK response without jsonp', async () => {
    const f = vi.fn(async () => ({ ok: false }) as Response)
    const j = vi.fn()
    expect(await searchCover('a', 'b', { fetch: f as unknown as typeof fetch, jsonp: j })).toBeNull()
    expect(j).not.toHaveBeenCalled()
  })
  it('returns null when there are no results', async () => {
    const f = vi.fn(async () => okJson({ results: [] }))
    expect(await searchCover('a', 'b', { fetch: f as unknown as typeof fetch })).toBeNull()
  })
  it('returns null when jsonp rejects (timeout)', async () => {
    const f = vi.fn(async () => { throw new TypeError('x') })
    const j = vi.fn(async () => { throw new Error('timeout') })
    expect(await searchCover('a', 'b', { fetch: f as unknown as typeof fetch, jsonp: j })).toBeNull()
  })
  it('returns null on malformed payload', async () => {
    const f = vi.fn(async () => okJson(null))
    expect(await searchCover('a', 'b', { fetch: f as unknown as typeof fetch })).toBeNull()
  })
})

describe('jsonp', () => {
  afterEach(() => { vi.useRealTimers(); document.head.innerHTML = '' })
  const cbName = () => {
    const s = document.querySelector('script')!
    return new URL(s.src).searchParams.get('callback')!
  }
  it('resolves with payload and cleans up', async () => {
    const p = jsonp('https://itunes.apple.com/search?term=a')
    const name = cbName()
    ;(window as unknown as Record<string, (v: unknown) => void>)[name]({ hi: 1 })
    expect(await p).toEqual({ hi: 1 })
    expect(document.querySelector('script')).toBeNull()
    expect(name in window).toBe(false)
  })
  it('rejects on script error and cleans up', async () => {
    const p = jsonp('https://itunes.apple.com/search?term=a')
    const name = cbName()
    document.querySelector('script')!.dispatchEvent(new Event('error'))
    await expect(p).rejects.toThrow()
    expect(document.querySelector('script')).toBeNull()
    expect(name in window).toBe(false)
  })
  it('rejects on timeout and cleans up', async () => {
    vi.useFakeTimers()
    const p = jsonp('https://itunes.apple.com/search?term=a', 8000)
    const assertion = expect(p).rejects.toThrow()
    const name = cbName()
    await vi.advanceTimersByTimeAsync(8000)
    await assertion
    expect(document.querySelector('script')).toBeNull()
    expect(name in window).toBe(false)
  })
})

describe('searchCover timeout', () => {
  afterEach(() => vi.useRealTimers())
  it('a hung fetch resolves null after 8 s and is aborted', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const f = vi.fn((_u: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>(() => {})
    })
    const j = vi.fn()
    let result: unknown = 'pending'
    void searchCover('a', 'b', { fetch: f as unknown as typeof fetch, jsonp: j }).then((r) => (result = r))
    await vi.advanceTimersByTimeAsync(7999)
    expect(result).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    expect(result).toBeNull()
    expect(signal?.aborted).toBe(true)
    expect(j).not.toHaveBeenCalled()
  })
  it('an aborted fetch does not fall back to jsonp', async () => {
    vi.useFakeTimers()
    const f = vi.fn(
      (_u: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('a', 'AbortError')))),
    )
    const j = vi.fn()
    const p = searchCover('a', 'b', { fetch: f as unknown as typeof fetch, jsonp: j })
    await vi.advanceTimersByTimeAsync(8000)
    expect(await p).toBeNull()
    expect(j).not.toHaveBeenCalled()
  })
})
