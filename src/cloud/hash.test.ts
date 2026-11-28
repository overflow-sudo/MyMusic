import { describe, expect, it } from 'vitest'
import { recordingId, sha256Hex } from './hash'

// Reference values from node:crypto / sha256sum.
const HELLO = 'b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9'

describe('sha256Hex', () => {
  it('hashes blobs, files and strings', async () => {
    expect(await sha256Hex(new Blob(['hello world']))).toBe(HELLO)
    expect(await sha256Hex(new File(['hello ', 'world'], 'a.mp3'))).toBe(HELLO)
    expect(await sha256Hex('hello world')).toBe(HELLO)
  })
  it('recording id matches the server formula', async () => {
    expect(await recordingId('s1', '2026-11-24_21-30-05_video.webm')).toBe('954de090bddd10100d86bb4e998d8933')
  })
})
