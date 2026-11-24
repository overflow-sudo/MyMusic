import { describe, it, expect } from 'vitest'
import { lightBus } from './lightBus'

describe('lightBus', () => {
  it('has defaults', () => {
    expect(lightBus.getLevel()).toBe(0)
    expect(lightBus.getSource()).toEqual({ kind: 'breath' })
    expect(lightBus.getHueBpm()).toBeNull()
  })
  it('stores values', () => {
    lightBus.setLevel(0.4)
    lightBus.setSource({ kind: 'free', bpm: 100 })
    lightBus.setHueBpm(100)
    expect(lightBus.getLevel()).toBe(0.4)
    expect(lightBus.getSource()).toEqual({ kind: 'free', bpm: 100 })
    expect(lightBus.getHueBpm()).toBe(100)
  })
})
