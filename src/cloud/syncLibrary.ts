import type { SongRecord } from '../../shared/api'
import { parseSong } from '../domain/library'
import type { Song } from '../domain/types'
import { CloudError, type CloudApi } from './api'
import { mergeLibraries, mergeSong } from './merge'

export type LibrarySyncApi = Pick<CloudApi, 'getLibrary' | 'putSong'>

export interface LibrarySyncDeps {
  api: LibrarySyncApi
  /** All local songs, tombstones included (read fresh each time). */
  getLocalSongs(): Song[]
  /** Replaces the local song list; must update what getLocalSongs returns synchronously. */
  applyMerged(songs: Song[]): Promise<void> | void
}

export interface LibrarySyncStats {
  /** Songs taken from the server (new or newer). */
  pulled: number
  pushed: number
  /** Puts the server refused (validation etc.); retried next pass. */
  failed: number
}

/** These end the pass; anything else only fails that one song. */
const fatal = (e: unknown) => e instanceof CloudError && (e.kind === 'offline' || e.kind === 'auth' || e.kind === 'rate')

const changed = (a: Song[], b: Song[]) => a.length !== b.length || a.some((s, i) => s !== b[i])

/**
 * One library pass: GET, merge, apply, then PUT each song the server should get, one at a time.
 * Local reads and the apply happen with no await in between, so an edit made during a request is never overwritten.
 */
export async function syncLibraryOnce({ api, getLocalSongs, applyMerged }: LibrarySyncDeps): Promise<LibrarySyncStats> {
  const stats: LibrarySyncStats = { pulled: 0, pushed: 0, failed: 0 }
  const { songs: raw } = await api.getLibrary()
  const remote = (Array.isArray(raw) ? raw : []).map(parseSong).filter((s): s is Song => s !== null)

  const local = getLocalSongs()
  const { merged, toPush } = mergeLibraries(local, remote)
  const before = new Map(local.map((s) => [s.id, s]))
  stats.pulled = merged.filter((s) => before.get(s.id) !== s && !toPush.includes(s.id)).length
  if (changed(local, merged)) await applyMerged(merged)

  for (const id of toPush) {
    const song = getLocalSongs().find((s) => s.id === id)
    if (!song) continue
    let res: Song | null
    try {
      res = parseSong(await api.putSong(song as unknown as SongRecord))
    } catch (e) {
      if (fatal(e)) throw e
      stats.failed++
      continue
    }
    stats.pushed++
    if (!res || res.id !== id) continue
    // The server answers with what it stored; merge it with the local copy as it is *now*.
    const songs = getLocalSongs()
    const i = songs.findIndex((s) => s.id === id)
    if (i < 0) continue
    const next = mergeSong(songs[i], res)!
    if (next !== songs[i]) await applyMerged(songs.map((s, j) => (j === i ? next : s)))
  }
  return stats
}
