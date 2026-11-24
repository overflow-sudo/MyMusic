import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getLightMode, setLightMode, onLightModeChange } from './lightPrefs'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('lightPrefs', () => {
  it('defaults to a', () => expect(getLightMode()).toBe('a'))
  it('invalid stored value → a', () => {
    localStorage.setItem('mm.light', 'x')
    expect(getLightMode()).toBe('a')
  })
  it('round-trips', () => {
    setLightMode('c')
    expect(getLightMode()).toBe('c')
    setLightMode('off')
    expect(getLightMode()).toBe('off')
  })
  it('notifies subscribers and unsubscribes', () => {
    const cb = vi.fn()
    const off = onLightModeChange(cb)
    setLightMode('c')
    expect(cb).toHaveBeenCalledWith('c')
    off()
    setLightMode('off')
    expect(cb).toHaveBeenCalledTimes(1)
  })
  it('throwing localStorage → default, no throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('no') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('no') })
    expect(getLightMode()).toBe('a')
    expect(() => setLightMode('c')).not.toThrow()
  })
})
