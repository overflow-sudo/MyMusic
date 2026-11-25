import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadImage } from '../storage/cover'

const resp = (ok: boolean, type: string) =>
  ({ ok, blob: async () => new Blob(['x'], { type }), headers: new Headers({ 'content-type': type }) }) as unknown as Response

describe('downloadImage', () => {
  it('returns blob for image', async () => {
    const b = await downloadImage('u', vi.fn(async () => resp(true, 'image/jpeg')) as unknown as typeof fetch)
    expect(b?.type).toBe('image/jpeg')
  })
  it('null on non-OK', async () => {
    expect(await downloadImage('u', vi.fn(async () => resp(false, 'image/jpeg')) as unknown as typeof fetch)).toBeNull()
  })
  it('null on non-image', async () => {
    expect(await downloadImage('u', vi.fn(async () => resp(true, 'text/html')) as unknown as typeof fetch)).toBeNull()
  })
  it('null on throw', async () => {
    expect(await downloadImage('u', vi.fn(async () => { throw new TypeError('x') }) as unknown as typeof fetch)).toBeNull()
  })
})

describe('downloadImage timeout', () => {
  afterEach(() => vi.useRealTimers())
  it('a hung download resolves null after 8 s and is aborted', async () => {
    vi.useFakeTimers()
    let signal: AbortSignal | undefined
    const f = vi.fn((_u: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined
      return new Promise<Response>(() => {})
    })
    let result: unknown = 'pending'
    void downloadImage('u', f as unknown as typeof fetch).then((r) => (result = r))
    await vi.advanceTimersByTimeAsync(7999)
    expect(result).toBe('pending')
    await vi.advanceTimersByTimeAsync(1)
    expect(result).toBeNull()
    expect(signal?.aborted).toBe(true)
  })
  it('a hung body read also times out', async () => {
    vi.useFakeTimers()
    const f = vi.fn(async () => ({ ok: true, blob: () => new Promise<Blob>(() => {}), headers: new Headers() }) as unknown as Response)
    const p = downloadImage('u', f as unknown as typeof fetch)
    await vi.advanceTimersByTimeAsync(8000)
    expect(await p).toBeNull()
  })
})
