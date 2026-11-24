import { describe, expect, it } from 'vitest'
import { validateSongInput } from './validate'

describe('validateSongInput', () => {
  it('flags all invalid fields', () => {
    const e = validateSongInput({ title: ' ', bpm: 29, countInBeats: 17 })
    expect(Object.keys(e).sort()).toEqual(['bpm', 'countInBeats', 'title'])
    expect(e.title).toMatch(/\S/)
  })
  it('rejects non-integers', () => {
    expect(validateSongInput({ title: 'x', bpm: 90.5, countInBeats: 4 }).bpm).toBeDefined()
  })
  it('accepts valid input and boundaries', () => {
    expect(validateSongInput({ title: 'x', bpm: 30, countInBeats: 1 })).toEqual({})
    expect(validateSongInput({ title: 'x', bpm: 300, countInBeats: 16 })).toEqual({})
  })
})
