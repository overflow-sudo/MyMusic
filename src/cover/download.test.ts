import { describe, expect, it, vi } from 'vitest'
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
