import { describe, expect, it } from 'vitest'
import { createMemoryDir } from './memoryDir'
import {
  backupBrokenLibrary, importTrack, listRecordings, loadLibrary, readTrack, removeTrack, saveLibrary, songDir,
} from './repo'
import { createSong, emptyLibrary } from '../domain/library'
import type { Song } from '../domain/types'

const mkSong = (): Song =>
  createSong({ title: 'Wonderwall', artist: 'Oasis', status: 'learning', bpm: 87, countInBeats: 4 }, new Date(2026, 10, 24))

describe('library persistence', () => {
  it('round-trips save -> load', async () => {
    const root = createMemoryDir()
    const lib = { ...emptyLibrary(), songs: [mkSong()], custom: 1 }
    await saveLibrary(root, lib)
    const r = await loadLibrary(root)
    expect(r.ok && r.library).toEqual(lib)
  })
  it('returns empty library when file is missing', async () => {
    const r = await loadLibrary(createMemoryDir())
    expect(r.ok && r.library).toEqual(emptyLibrary())
  })
  it('reports corrupt JSON without overwriting', async () => {
    const root = createMemoryDir()
    await root.writeFile('mymusic.json', '{oops')
    const r = await loadLibrary(root)
    expect(r.ok).toBe(false)
    expect(await (await root.readFile('mymusic.json'))!.text()).toBe('{oops')
  })
  it('backs up broken library bytes', async () => {
    const root = createMemoryDir()
    await root.writeFile('mymusic.json', '{oops')
    const name = await backupBrokenLibrary(root, new Date(2026, 10, 24, 21, 30, 5))
    expect(name).toBe('mymusic.broken-2026-11-24_21-30-05.json')
    expect(name).toMatch(/^mymusic\.broken-\d{4}-\d\d-\d\d_\d\d-\d\d-\d\d\.json$/)
    expect(await (await root.readFile(name))!.text()).toBe('{oops')
    expect(await (await root.readFile('mymusic.json'))!.text()).toBe('{oops')
  })
})

describe('recordings and tracks', () => {
  it('lists recordings newest first, ignoring other files', async () => {
    const root = createMemoryDir()
    const song = mkSong()
    const d = await songDir(root, song)
    for (const n of ['2026-11-20_19-05-12_ses.webm', '2026-11-24_21-30-05_video.webm', 'track.mp3', 'notes.txt'])
      await d.writeFile(n, 'x')
    const list = await listRecordings(root, song)
    expect(list.map((e) => [e.fileName, e.kind])).toEqual([
      ['2026-11-24_21-30-05_video.webm', 'video'],
      ['2026-11-20_19-05-12_ses.webm', 'ses'],
    ])
    expect(list[0].date).toEqual(new Date(2026, 10, 24, 21, 30, 5))
  })
  it('returns [] and creates nothing for a missing folder', async () => {
    const root = createMemoryDir()
    expect(await listRecordings(root, mkSong())).toEqual([])
    expect(await root.dir('recordings')).toBeNull()
  })
  it('imports a track, replacing other track.* files', async () => {
    const root = createMemoryDir()
    const song = mkSong()
    const d = await songDir(root, song)
    await d.writeFile('track.wav', 'old')
    await d.writeFile('keep.txt', 'k')
    const t = await importTrack(root, song, new File(['new'], 'Song.MP3'))
    expect(t).toEqual({ fileName: 'track.mp3', startSec: 0, volume: 0.7 })
    expect(await d.readFile('track.wav')).toBeNull()
    expect(await d.readFile('keep.txt')).not.toBeNull()
    expect(await (await d.readFile('track.mp3'))!.text()).toBe('new')
  })
  it('uses mp3 when the file has no extension', async () => {
    const root = createMemoryDir()
    const t = await importTrack(root, mkSong(), new File(['a'], 'noext'))
    expect(t.fileName).toBe('track.mp3')
  })
  it('reads and removes the track', async () => {
    const root = createMemoryDir()
    const song = mkSong()
    expect(await readTrack(root, song)).toBeNull()
    await importTrack(root, song, new File(['abc'], 'a.wav'))
    expect(await (await readTrack(root, song))!.text()).toBe('abc')
    await removeTrack(root, song)
    expect(await readTrack(root, song)).toBeNull()
  })
})
