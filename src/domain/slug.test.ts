import { describe, expect, it } from 'vitest'
import { slugify, songFolderName } from './slug'

describe('slugify', () => {
  it('handles illegal characters', () => {
    expect(slugify('AC/DC: Back In Black?')).toBe('ac-dc-back-in-black')
  })
  it('transliterates Turkish letters', () => {
    expect(slugify('Çalıştığım Şarkı.')).toBe('calistigim-sarki')
    expect(slugify('IŞIK İÖÜ')).toBe('isik-iou')
  })
  it('falls back to sarki', () => {
    expect(slugify('???')).toBe('sarki')
    expect(slugify('')).toBe('sarki')
  })
  it('limits length and trims dashes', () => {
    const s = slugify('a'.repeat(39) + ' bbbbbbbb')
    expect(s.length).toBeLessThanOrEqual(40)
    expect(s).toBe('a'.repeat(39))
    expect(slugify('-- x --')).toBe('x')
  })
})

describe('songFolderName', () => {
  it('prefixes the first 4 id chars', () => {
    expect(songFolderName('3f9a77c0-1111', 'Wonderwall')).toBe('3f9a-wonderwall')
  })
})
