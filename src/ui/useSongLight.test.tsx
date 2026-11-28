import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lightBus } from '../light/lightBus'
import { setLightColor } from '../light/lightPrefs'
import { useSongLight } from './useSongLight'

beforeEach(() => {
  lightBus.setSource({ kind: 'breath' })
  lightBus.setHueBpm(null)
})
afterEach(cleanup)

describe('useSongLight', () => {
  it('song screen: free pulse at the song tempo and its hue; list: breath, default hue', () => {
    const { rerender } = renderHook(({ bpm }: { bpm: number | null }) => useSongLight(bpm), { initialProps: { bpm: 120 as number | null } })
    expect(lightBus.getSource()).toEqual({ kind: 'free', bpm: 120 })
    expect(lightBus.getHueBpm()).toBe(120)
    rerender({ bpm: 90 })
    expect(lightBus.getSource()).toEqual({ kind: 'free', bpm: 90 })
    expect(lightBus.getHueBpm()).toBe(90)
    rerender({ bpm: null })
    expect(lightBus.getSource()).toEqual({ kind: 'breath' })
    expect(lightBus.getHueBpm()).toBeNull()
  })

  it('a tempo edit during a take keeps the take as the beat source', () => {
    const take = { kind: 'take' as const, ctx: { currentTime: 0 }, plan: { clickTimes: [], downbeat: 0, bpm: 100 } }
    const { rerender } = renderHook(({ bpm }: { bpm: number | null }) => useSongLight(bpm), { initialProps: { bpm: 100 as number | null } })
    lightBus.setSource(take)
    rerender({ bpm: 110 })
    expect(lightBus.getSource()).toBe(take)
    expect(lightBus.getHueBpm()).toBe(110)
  })
})

describe('useSongLight color', () => {
  it('song color beats global; clearing falls back; auto → null', () => {
    localStorage.clear()
    const { rerender } = renderHook(({ c }: { c?: string }) => useSongLight(100, { lightColor: c }), { initialProps: { c: undefined as string | undefined } })
    expect(lightBus.getFixedHue()).toBeNull()
    act(() => setLightColor('#ef4444'))
    expect(lightBus.getFixedHue()).toBeCloseTo(0, 0)
    rerender({ c: '#22c55e' })
    expect(lightBus.getFixedHue()).toBeCloseTo(142, 0)
    rerender({ c: undefined })
    expect(lightBus.getFixedHue()).toBeCloseTo(0, 0)
    act(() => setLightColor('auto'))
    expect(lightBus.getFixedHue()).toBeNull()
  })
  it('floors saturation at 40%', () => {
    renderHook(() => useSongLight(100, { lightColor: '#808080' }))
    expect(lightBus.getFixedSat()).toBe(0.4)
  })
})
