import '@testing-library/jest-dom/vitest'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lightBus } from '../light/lightBus'
import { setLightMode } from '../light/lightPrefs'
import LightLayer from './LightLayer'

let frames: FrameRequestCallback[] = []
const raf = vi.fn((cb: FrameRequestCallback) => {
  frames.push(cb)
  return frames.length
})
const caf = vi.fn()

function stubMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((q: string) => ({ matches: reduce && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} })),
  )
}

const cssVar = (n: string) => document.documentElement.style.getPropertyValue(n)
const layer = () => document.querySelector('.light-layer') as HTMLElement

beforeEach(() => {
  frames = []
  raf.mockClear()
  caf.mockClear()
  vi.stubGlobal('requestAnimationFrame', raf)
  vi.stubGlobal('cancelAnimationFrame', caf)
  stubMotion(false)
  localStorage.clear()
  lightBus.setSource({ kind: 'breath' })
  lightBus.setLevel(0)
  lightBus.setHueBpm(null)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('style')
})

describe('LightLayer', () => {
  it("mode 'off' renders a hidden layer and schedules no frames", () => {
    localStorage.setItem('mm.light', 'off')
    render(<LightLayer />)
    expect(layer()).not.toBeVisible()
    expect(raf).not.toHaveBeenCalled()
  })

  it('defaults to mode A and switches class on setLightMode', () => {
    render(<LightLayer />)
    expect(layer()).toHaveClass('light-a')
    expect(layer()).toBeVisible()
    act(() => setLightMode('c'))
    expect(layer()).toHaveClass('light-c')
    expect(layer()).not.toHaveClass('light-a')
    act(() => setLightMode('off'))
    expect(layer()).not.toBeVisible()
  })

  it('free source at t=0 gives a full pulse; hue from bpm plus level', () => {
    lightBus.setSource({ kind: 'free', bpm: 120 })
    lightBus.setHueBpm(60)
    lightBus.setLevel(0.5)
    render(<LightLayer />)
    expect(raf).toHaveBeenCalled()
    act(() => frames[frames.length - 1](0))
    expect(cssVar('--beat-a')).toBe('1.000')
    expect(cssVar('--lvl')).toBe('0.500')
    expect(cssVar('--beat-h')).toBe('245.0')
    expect(raf.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('uses hue 205 when no song bpm, breath on list', () => {
    render(<LightLayer />)
    act(() => frames[frames.length - 1](3000))
    expect(cssVar('--beat-h')).toBe('205.0')
    expect(cssVar('--beat-a')).toBe('1.000')
  })

  it('take source before the first click gives no pulse', () => {
    lightBus.setSource({ kind: 'take', ctx: { currentTime: 0.5 }, plan: { clickTimes: [1, 1.5], downbeat: 2, bpm: 120 } })
    render(<LightLayer />)
    act(() => frames[frames.length - 1](0))
    expect(cssVar('--beat-a')).toBe('0.000')
  })

  it('reduced motion: no rAF and static values', () => {
    stubMotion(true)
    lightBus.setSource({ kind: 'free', bpm: 120 })
    lightBus.setLevel(0.8)
    render(<LightLayer />)
    expect(raf).not.toHaveBeenCalled()
    expect(cssVar('--beat-a')).toBe('0.3')
    expect(cssVar('--lvl')).toBe('0')
  })

  it('cancels its frame on unmount', () => {
    const { unmount } = render(<LightLayer />)
    unmount()
    expect(caf).toHaveBeenCalled()
  })
})
