import { describe, it, expect } from 'vitest'
import { audioConstraints, videoConstraints } from './constraints'

describe('audioConstraints', () => {
  it('disables processing, stereo 48k', () => {
    expect(audioConstraints()).toEqual({
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      channelCount: 2, sampleRate: 48000,
    })
  })
  it('adds exact deviceId', () => {
    expect(audioConstraints('x')).toMatchObject({ deviceId: { exact: 'x' }, sampleRate: 48000 })
    expect('deviceId' in audioConstraints()).toBe(false)
  })
})
describe('videoConstraints', () => {
  it('uses ideal 1280x720@30', () => {
    expect(videoConstraints()).toEqual({ width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } })
    expect(videoConstraints('v').deviceId).toEqual({ exact: 'v' })
  })
})
