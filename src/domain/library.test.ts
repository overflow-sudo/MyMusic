import { describe, expect, it } from 'vitest'
import { createSong, emptyLibrary, parseLibrary, removeSong, serializeLibrary, updateSong } from './library'

const now = new Date('2026-11-24T10:00:00.000Z')
const input = { title: 'Wonderwall', artist: 'Oasis', status: 'learning' as const, bpm: 87, countInBeats: 4 }

describe('parseLibrary', () => {
  it('null gives empty library', () => {
    const r = parseLibrary(null)
    expect(r).toEqual({ ok: true, library: emptyLibrary() })
  })
  it('corrupt JSON fails', () => {
    expect(parseLibrary('{').ok).toBe(false)
    expect(parseLibrary('[]').ok).toBe(false)
  })
  it('preserves unknown fields', () => {
    const text = JSON.stringify({
      version: 1, foo: 1, settings: { latencyCompensationMs: 40, bar: 2 },
      songs: [{ ...createSong(input, now, 'abcd-1'), chords: 'Am' }],
    })
    const r = parseLibrary(text)
    if (!r.ok) throw new Error(r.error)
    const out = JSON.parse(serializeLibrary(r.library))
    expect(out.foo).toBe(1)
    expect(out.settings.bar).toBe(2)
    expect(out.songs[0].chords).toBe('Am')
  })
  it('defaults missing countInBeats to 4', () => {
    const s: Record<string, unknown> = { ...createSong(input, now, 'abcd-1') }
    delete s.countInBeats
    const r = parseLibrary(JSON.stringify({ version: 1, songs: [s] }))
    if (!r.ok) throw new Error(r.error)
    expect(r.library.songs[0].countInBeats).toBe(4)
    expect(r.library.settings.latencyCompensationMs).toBeNull()
  })
})

describe('serializeLibrary', () => {
  it('uses 2-space indent and trailing newline', () => {
    const t = serializeLibrary(emptyLibrary())
    expect(t.endsWith('}\n')).toBe(true)
    expect(t).toContain('\n  "version": 1')
  })
})

describe('songs', () => {
  it('createSong', () => {
    const s = createSong(input, now, '3f9a77c0-x')
    expect(s.folderName).toBe('3f9a-wonderwall')
    expect(s.createdAt).toBe(now.toISOString())
    expect(s.updatedAt).toBe(now.toISOString())
    expect(createSong(input, now).id).toMatch(/^[0-9a-f-]{36}$/)
  })
  it('updateSong bumps only target', () => {
    const a = createSong(input, now, 'aaaa-1')
    const b = createSong({ ...input, title: 'B' }, now, 'bbbb-1')
    const lib = { ...emptyLibrary(), songs: [a, b] }
    const later = new Date('2026-12-01T00:00:00.000Z')
    const out = updateSong(lib, 'aaaa-1', { bpm: 100 }, later)
    expect(out.songs[0].bpm).toBe(100)
    expect(out.songs[0].updatedAt).toBe(later.toISOString())
    expect(out.songs[1]).toBe(b)
    expect(out.songs[0].folderName).toBe(a.folderName)
  })
  it('removeSong', () => {
    const a = createSong(input, now, 'aaaa-1')
    expect(removeSong({ ...emptyLibrary(), songs: [a] }, 'aaaa-1').songs).toEqual([])
  })
})
