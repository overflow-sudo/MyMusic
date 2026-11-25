import { describe, expect, it } from 'vitest'
import { isChord, parseChords } from './parseChords'

describe('isChord', () => {
  it.each(['Am', 'G', 'C/E', 'F#m7', 'Bbsus4', 'D/F#', 'Cmaj7', 'Gadd9', 'E7', 'Dsus2'])('accepts %s', (t) => {
    expect(isChord(t)).toBe(true)
  })
  it.each(['Am I', 'Hello', 'Ab-', 'H', ''])('rejects %s', (t) => {
    expect(isChord(t)).toBe(false)
  })
})

describe('parseChords', () => {
  it('splits chord and lyric lines, keeping spacing', () => {
    expect(parseChords('Am  G  C\nHello world')).toEqual([
      { kind: 'chords', text: 'Am  G  C' },
      { kind: 'lyric', text: 'Hello world' },
    ])
  })
  it.each(['A day in the life', 'Am I evil', 'E bir gün'])('treats "%s" as lyric', (l) => {
    expect(parseChords(l)).toEqual([{ kind: 'lyric', text: l }])
  })
  it('parses section labels', () => {
    expect(parseChords('[Verse]')).toEqual([{ kind: 'section', label: 'Verse' }])
    expect(parseChords('  [Chorus 2] ')).toEqual([{ kind: 'section', label: 'Chorus 2' }])
  })
  it('parses inline chords', () => {
    expect(parseChords('[Am]Hello [G]world')).toEqual([
      { kind: 'inline', parts: [{ chord: 'Am', text: 'Hello ' }, { chord: 'G', text: 'world' }] },
    ])
    expect(parseChords('Intro [Am]Hello')).toEqual([
      { kind: 'inline', parts: [{ text: 'Intro ' }, { chord: 'Am', text: 'Hello' }] },
    ])
  })
  it('treats a lone chord bracket as inline, not a section', () => {
    expect(parseChords('[Am]')).toEqual([{ kind: 'inline', parts: [{ chord: 'Am', text: '' }] }])
  })
  it('allows bars, repeats, parens, N.C. on chord lines', () => {
    for (const l of ['G | C | x2', 'Am || G', '(Am G) x3', '(Am G)', 'Am - G / C', 'N.C. Am', 'A']) {
      expect(parseChords(l)).toEqual([{ kind: 'chords', text: l }])
    }
  })
  it('requires at least one real chord', () => {
    expect(parseChords('| x2')[0].kind).toBe('lyric')
    expect(parseChords('N.C.')[0].kind).toBe('lyric')
  })
  it('handles blank lines and CRLF', () => {
    expect(parseChords('Am G\r\n\r\nHello')).toEqual([
      { kind: 'chords', text: 'Am G' },
      { kind: 'blank' },
      { kind: 'lyric', text: 'Hello' },
    ])
    expect(parseChords('   ')).toEqual([{ kind: 'blank' }])
  })
})
