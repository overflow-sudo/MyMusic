import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getLightMode, setLightMode, onLightModeChange, effectiveLightColor, getLightColor, setLightColor, onLightColorChange } from './lightPrefs'

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

describe('light color pref', () => {
  it('defaults to auto; invalid stored → auto', () => {
    expect(getLightColor()).toBe('auto')
    localStorage.setItem('mm.lightColor', 'red')
    expect(getLightColor()).toBe('auto')
  })
  it('round-trips, notifies, rejects invalid', () => {
    const cb = vi.fn()
    onLightColorChange(cb)
    setLightColor('#3B82F6')
    expect(getLightColor()).toBe('#3b82f6')
    expect(cb).toHaveBeenCalledWith('#3b82f6')
    setLightColor('nope')
    expect(getLightColor()).toBe('auto')
  })
  it('effective: song beats global beats auto', () => {
    expect(effectiveLightColor('#ef4444', { lightColor: '#22c55e' })).toBe('#22c55e')
    expect(effectiveLightColor('#ef4444', {})).toBe('#ef4444')
    expect(effectiveLightColor('#ef4444')).toBe('#ef4444')
    expect(effectiveLightColor('auto', {})).toBeNull()
    expect(effectiveLightColor('auto', { lightColor: 'bad' })).toBeNull()
  })
})
