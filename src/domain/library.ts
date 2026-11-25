import { songFolderName } from './slug'
import type { Library, Song, SongStatus } from './types'

export function emptyLibrary(): Library {
  return { version: 1, settings: { latencyCompensationMs: null }, songs: [] }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

const validCover = (c: unknown): boolean =>
  isObject(c) &&
  (c.source === 'none' ||
    ((c.source === 'itunes' || c.source === 'user') && (typeof c.fileName === 'string' || typeof c.url === 'string')))

export function parseLibrary(
  text: string | null,
): { ok: true; library: Library } | { ok: false; error: string } {
  if (text === null) return { ok: true, library: emptyLibrary() }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'mymusic.json okunamadı: geçersiz JSON.' }
  }
  if (!isObject(raw)) return { ok: false, error: 'mymusic.json beklenen biçimde değil.' }
  if (raw.songs !== undefined && !Array.isArray(raw.songs))
    return { ok: false, error: 'mymusic.json: şarkı listesi geçersiz.' }
  const songs = ((raw.songs ?? []) as unknown[]).map((s) => {
    if (!isObject(s)) return null
    const song: Record<string, unknown> = { ...s, countInBeats: s.countInBeats === undefined ? 4 : s.countInBeats }
    if (song.cover !== undefined && !validCover(song.cover)) delete song.cover
    if (song.chords !== undefined && typeof song.chords !== 'string') delete song.chords
    const ok =
      typeof song.id === 'string' && typeof song.title === 'string' && typeof song.folderName === 'string' &&
      typeof song.bpm === 'number' && typeof song.countInBeats === 'number'
    return ok ? (song as unknown as Song) : null
  })
  if (songs.some((s) => s === null)) return { ok: false, error: 'mymusic.json: şarkı kaydı geçersiz.' }
  const settings = isObject(raw.settings) ? raw.settings : {}
  return {
    ok: true,
    library: {
      ...raw,
      version: 1,
      settings: {
        ...settings,
        latencyCompensationMs:
          typeof settings.latencyCompensationMs === 'number' ? settings.latencyCompensationMs : null,
      },
      songs: songs as Song[],
    },
  }
}

export function serializeLibrary(lib: Library): string {
  return JSON.stringify(lib, null, 2) + '\n'
}

export function createSong(
  input: { title: string; artist: string; status: SongStatus; bpm: number; countInBeats: number },
  now: Date,
  id: string = crypto.randomUUID(),
): Song {
  const iso = now.toISOString()
  return { ...input, id, folderName: songFolderName(id, input.title), createdAt: iso, updatedAt: iso }
}

export function updateSong(lib: Library, id: string, patch: Partial<Song>, now: Date): Library {
  return {
    ...lib,
    songs: lib.songs.map((s) =>
      s.id === id ? { ...s, ...patch, id: s.id, folderName: s.folderName, updatedAt: now.toISOString() } : s,
    ),
  }
}

export function removeSong(lib: Library, id: string): Library {
  return { ...lib, songs: lib.songs.filter((s) => s.id !== id) }
}
