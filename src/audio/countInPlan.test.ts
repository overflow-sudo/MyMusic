import { describe, it, expect } from 'vitest'
import { planCountIn } from './countInPlan'

describe('planCountIn', () => {
  it('schedules clicks, accent, downbeat and recorder start', () => {
    const p = planCountIn({ bpm: 120, beats: 4, now: 10 })
    expect(p.clickTimes).toHaveLength(4)
    ;[10.1, 10.6, 11.1, 11.6].forEach((t, i) => expect(p.clickTimes[i]).toBeCloseTo(t))
    expect(p.accent).toEqual([true, false, false, false])
    expect(p.downbeat).toBeCloseTo(12.1)
    expect(p.recorderStart).toBeCloseTo(11.95)
  })
  it('honours custom lead-in and pre-roll', () => {
    const p = planCountIn({ bpm: 60, beats: 2, now: 0, leadInSec: 0.5, preRollSec: 0.25 })
    expect(p.clickTimes).toEqual([0.5, 1.5])
    expect(p.downbeat).toBeCloseTo(2.5)
    expect(p.recorderStart).toBeCloseTo(2.25)
  })
})
