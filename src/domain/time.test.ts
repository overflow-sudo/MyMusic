import { describe, expect, it } from 'vitest'
import { formatTimecode, parseRecordingFileName, parseTimecode, recordingFileName } from './time'

describe('timecode', () => {
  it('parses', () => {
    expect(parseTimecode('0:12')).toBe(12)
    expect(parseTimecode('1:05.5')).toBe(65.5)
    expect(parseTimecode('12')).toBe(12)
    expect(parseTimecode('abc')).toBeNull()
    expect(parseTimecode('-1')).toBeNull()
    expect(parseTimecode('')).toBeNull()
  })
  it('formats', () => {
    expect(formatTimecode(65)).toBe('1:05')
    expect(formatTimecode(5)).toBe('0:05')
  })
})

describe('recording file names', () => {
  const d = new Date(2026, 10, 24, 21, 30, 5)
  it('formats local time', () => {
    expect(recordingFileName(d, 'video')).toBe('2026-11-24_21-30-05_video.webm')
    expect(recordingFileName(d, 'ses')).toBe('2026-11-24_21-30-05_ses.webm')
  })
  it('round-trips', () => {
    expect(parseRecordingFileName(recordingFileName(d, 'ses'))).toEqual({ date: d, kind: 'ses' })
    expect(parseRecordingFileName(recordingFileName(d, 'video'))?.kind).toBe('video')
  })
  it('rejects others', () => {
    expect(parseRecordingFileName('track.mp3')).toBeNull()
  })
})
