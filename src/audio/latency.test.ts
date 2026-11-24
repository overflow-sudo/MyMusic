import { describe, it, expect } from 'vitest'
import { defaultLatencyMs } from './latency'

describe('defaultLatencyMs', () => {
  it('sums base, output and input latency in ms', () => {
    expect(defaultLatencyMs({ baseLatency: 0.01, outputLatency: 0.02 }, 0.015)).toBe(45)
  })
  it('missing values count as 0, input defaults to 10 ms', () => {
    expect(defaultLatencyMs({})).toBe(10)
  })
})
