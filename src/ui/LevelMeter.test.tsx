import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { lightBus } from '../light/lightBus'
import LevelMeter from './LevelMeter'

const RMS = 0.01 // -40 dBFS -> level 1/3

class FakeAnalyser {
  fftSize = 0
  getFloatTimeDomainData(buf: Float32Array) {
    buf.fill(RMS)
  }
  connect() {}
}
class FakeCtx {
  createAnalyser() {
    return new FakeAnalyser()
  }
  createMediaStreamSource() {
    return { connect: () => {} }
  }
  resume() {
    return Promise.resolve()
  }
  close() {
    return Promise.resolve()
  }
}

beforeEach(() => {
  vi.stubGlobal('AudioContext', FakeCtx)
  vi.stubGlobal('requestAnimationFrame', () => 1)
  vi.stubGlobal('cancelAnimationFrame', () => {})
  lightBus.setLevel(0)
})
afterEach(() => vi.unstubAllGlobals())

describe('LevelMeter', () => {
  it('publishes the mapped level to the light bus and resets on unmount', () => {
    const { unmount } = render(<LevelMeter stream={{} as MediaStream} />)
    expect(lightBus.getLevel()).toBeCloseTo((20 * Math.log10(RMS) + 60) / 60, 5)
    unmount()
    expect(lightBus.getLevel()).toBe(0)
  })
})
