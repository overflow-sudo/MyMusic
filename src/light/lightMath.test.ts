import { describe, it, expect } from 'vitest'
import { hueForBpm, levelFromDb, pulseFromPhase, takePhase, freePhase, breath, hexToHue as _h2h, hexSaturation as _hs, hueFor as _hf } from './lightMath'

const plan = { clickTimes: [10.1, 10.6], downbeat: 11.1, bpm: 120 }

describe('lightMath', () => {
  it('hueForBpm', () => {
    expect(hueForBpm(60)).toBe(230)
    expect(hueForBpm(160)).toBe(15)
    expect(hueForBpm(110)).toBeCloseTo(122.5)
    expect(hueForBpm(40)).toBe(230)
    expect(hueForBpm(200)).toBe(15)
  })
  it('levelFromDb', () => {
    expect(levelFromDb(-60)).toBe(0)
    expect(levelFromDb(0)).toBe(1)
    expect(levelFromDb(-30)).toBeCloseTo(0.5)
    expect(levelFromDb(-90)).toBe(0)
    expect(levelFromDb(6)).toBe(1)
  })
  it('pulseFromPhase', () => {
    expect(pulseFromPhase(0)).toBe(1)
    expect(pulseFromPhase(0.5)).toBeCloseTo(0.125)
  })
  it('takePhase', () => {
    expect(takePhase(9.9, plan)).toBeNull()
    expect(takePhase(10.35, plan)).toBeCloseTo(0.5)
    expect(takePhase(10.85, plan)).toBeCloseTo(0.5)
    expect(takePhase(11.1, plan)).toBeCloseTo(0)
    expect(takePhase(11.35, plan)).toBeCloseTo(0.5)
    expect(takePhase(11.85, plan)).toBeCloseTo(0.5)
  })
  it('takePhase is null with no clicks before the downbeat', () => {
    expect(takePhase(5, { clickTimes: [], downbeat: 10, bpm: 120 })).toBeNull()
    expect(takePhase(10.25, { clickTimes: [], downbeat: 10, bpm: 120 })).toBeCloseTo(0.5)
  })
  it('takePhase returns 0 for a non-positive interval', () => {
    expect(takePhase(12, { clickTimes: [10], downbeat: 12, bpm: -1 })).toBe(0)
    expect(takePhase(13, { clickTimes: [10], downbeat: 12, bpm: 0 })).toBe(0)
  })
  it('pulseFromPhase clamps phase to 0..1', () => {
    expect(pulseFromPhase(-0.5)).toBe(1)
    expect(pulseFromPhase(1.5)).toBe(0)
  })
  it('freePhase', () => {
    expect(freePhase(250, 120)).toBeCloseTo(0.5)
    expect(freePhase(500, 120)).toBeCloseTo(0)
  })
  it('breath is periodic 6000ms within 0..1', () => {
    expect(breath(0)).toBeCloseTo(breath(6000))
    for (let t = 0; t < 6000; t += 250) {
      expect(breath(t)).toBeGreaterThanOrEqual(0)
      expect(breath(t)).toBeLessThanOrEqual(1)
    }
  })
})

describe('light color math', () => {
  it('hexToHue', () => {
    expect(_h2h('#ef4444')).toBeCloseTo(0, 0)
    expect(_h2h('#3b82f6')).toBeCloseTo(217, 0)
    expect(_h2h('#22c55e')).toBeCloseTo(142, 0)
  })
  it('saturation: grey 0, vivid high', () => {
    expect(_hs('#808080')).toBe(0)
    expect(_hs('#3b82f6')).toBeGreaterThan(0.9)
  })
  it('hueFor: fixed ignores level; auto adds it', () => {
    expect(_hf(120, 0, 142)).toBe(142)
    expect(_hf(120, 1, 142)).toBe(142)
    expect(_hf(60, 0.5, null)).toBe(245)
    expect(_hf(null, 0, null)).toBe(205)
  })
})
