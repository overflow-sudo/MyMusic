import { describe, it, expect } from 'vitest'
import { pickMimeType } from './mime'

describe('pickMimeType', () => {
  it('prefers vp9 for video', () => {
    expect(pickMimeType('video', () => true)).toBe('video/webm;codecs=vp9,opus')
  })
  it('falls back to vp8', () => {
    expect(pickMimeType('video', t => t.includes('vp8'))).toBe('video/webm;codecs=vp8,opus')
  })
  it('falls back to plain webm', () => {
    expect(pickMimeType('video', t => t === 'video/webm')).toBe('video/webm')
    expect(pickMimeType('video', () => false)).toBe('video/webm')
  })
  it('audio prefers opus', () => {
    expect(pickMimeType('ses', () => true)).toBe('audio/webm;codecs=opus')
    expect(pickMimeType('ses', t => t === 'audio/webm')).toBe('audio/webm')
    expect(pickMimeType('ses', () => false)).toBe('audio/webm')
  })
})
