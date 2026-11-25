import { useCallback, useEffect, useMemo, useRef } from 'react'
import type { Cover, Song } from '../domain/types'
import type { FsDir } from '../storage/fsDir'
import { downloadImage, removeCover as removeCoverFiles, writeCover } from '../storage/cover'
import { searchCover, type CoverHit } from './itunes'

export type FindResult = 'found' | 'none'

export interface CoverActions {
  /**
   * Searches iTunes and saves the hit. Rejects only when saving fails; a stale result is dropped ('found').
   * With `once`, a song (id + title + artist) already searched this session is not searched again.
   */
  findCover(song: Song, opts?: { once?: boolean }): Promise<FindResult>
  setUserCover(song: Song, file: File): Promise<void>
  removeCover(song: Song): Promise<void>
}

interface Options {
  /** Search covers for coverless songs (the list is on screen and the library is ready). */
  backfill?: boolean
  search?: (title: string, artist: string) => Promise<CoverHit | null>
  download?: (url: string) => Promise<Blob | null>
}

const MAX_CONCURRENT = 2
// A rename gives the song a new key, so it becomes eligible again.
const keyOf = (s: Song) => `${s.id}|${s.title}|${s.artist}`
const sameCover = (a: Cover | undefined, b: Cover | undefined) =>
  a === b || (!!a && !!b && a.source === b.source && a.fileName === b.fileName && a.url === b.url)
const extOf = (file: File) => {
  const dot = file.name.lastIndexOf('.')
  return dot > 0 ? file.name.slice(dot + 1) : (file.type.split('/')[1] ?? 'jpg')
}

export function useCovers(
  root: FsDir,
  songs: Song[],
  patchSong: (id: string, patch: Partial<Song>) => Promise<void>,
  { backfill = false, search = searchCover, download = downloadImage }: Options = {},
): CoverActions {
  const songsRef = useRef(songs)
  const deps = useRef({ root, patchSong, search, download })
  // Declared first so it runs before the backfill effect below.
  useEffect(() => {
    songsRef.current = songs
    deps.current = { root, patchSong, search, download }
  })

  // Session-level bookkeeping (lives as long as the open folder).
  const attempted = useRef(new Set<string>())
  const queued = useRef(new Set<string>())
  const pending = useRef(new Map<string, Promise<FindResult>>())
  const results = useRef(new Map<string, FindResult>())
  // Bumped whenever this hook changes a song's cover, so a find that started earlier sees it at once.
  const versions = useRef(new Map<string, number>())
  // Cover file writes and their patches run one at a time, so a find can't write over a picked image mid-way.
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const queue = useRef<string[]>([])
  const running = useRef(0)
  const alive = useRef(true)

  const serial = useCallback(<T,>(op: () => Promise<T>): Promise<T> => {
    const run = chain.current.then(op)
    chain.current = run.catch(() => undefined)
    return run
  }, [])
  const bump = (id: string) => versions.current.set(id, (versions.current.get(id) ?? 0) + 1)
  const latest = (id: string) => songsRef.current.find((s) => s.id === id)

  const findCover = useCallback(
    (song: Song, opts?: { once?: boolean }): Promise<FindResult> => {
      const key = keyOf(song)
      const existing = pending.current.get(key)
      if (existing) return existing
      if (opts?.once && attempted.current.has(key)) return Promise.resolve(results.current.get(key) ?? 'none')
      attempted.current.add(key)
      const known = latest(song.id)
      const startCover = known ? known.cover : song.cover
      const startVersion = versions.current.get(song.id) ?? 0
      // Discard the result if the song is gone or its cover changed since the find started.
      const stale = () => {
        const now = latest(song.id)
        return !alive.current || !now || (versions.current.get(song.id) ?? 0) !== startVersion || !sameCover(now.cover, startCover)
      }
      const run = (async (): Promise<FindResult> => {
        const { search, download } = deps.current
        const hit = await search(song.title, song.artist)
        if (!hit) return 'none'
        const blob = await download(hit.artworkUrl)
        return serial(async (): Promise<FindResult> => {
          if (stale()) return 'found'
          const { root, patchSong } = deps.current
          // Checked again right before writing (inside the serial lock), so a user's own file is never replaced.
          const cover: Cover = blob
            ? { source: 'itunes', fileName: await writeCover(root, song, blob, 'jpg') }
            : { source: 'itunes', url: hit.artworkUrl }
          // Only a deleted song can turn stale while writing (cover edits wait for the lock); its folder keeps the file.
          if (stale()) return 'found'
          bump(song.id)
          await patchSong(song.id, { cover })
          return 'found'
        })
      })()
      const tracked = run
        .then((r) => {
          results.current.set(key, r)
          return r
        })
        .finally(() => pending.current.delete(key))
      pending.current.set(key, tracked)
      return tracked
    },
    [serial],
  )

  const setUserCover = useCallback(
    (song: Song, file: File) =>
      serial(async () => {
        const { root, patchSong } = deps.current
        bump(song.id)
        const fileName = await writeCover(root, song, file, extOf(file))
        await patchSong(song.id, { cover: { source: 'user', fileName } })
      }),
    [serial],
  )

  const removeCover = useCallback(
    (song: Song) =>
      serial(async () => {
        const { root, patchSong } = deps.current
        bump(song.id)
        // Removed on purpose: the backfill must not bring it straight back this session.
        attempted.current.add(keyOf(song))
        // Patch first: if it fails the song still points at an existing file; a leftover file is harmless.
        await patchSong(song.id, { cover: undefined })
        await removeCoverFiles(root, song)
      }),
    [serial],
  )

  const pump = useCallback(function pump() {
    while (alive.current && running.current < MAX_CONCURRENT && queue.current.length > 0) {
      const song = latest(queue.current.shift()!)
      if (!song || song.cover || attempted.current.has(keyOf(song))) continue
      running.current++
      findCover(song, { once: true })
        .catch(() => 'none')
        .finally(() => {
          running.current--
          pump()
        })
    }
  }, [findCover])

  useEffect(() => {
    if (!backfill) return
    for (const s of songs) {
      const key = keyOf(s)
      if (s.cover || attempted.current.has(key) || queued.current.has(key)) continue
      queued.current.add(key)
      queue.current.push(s.id)
    }
    pump()
  }, [songs, backfill, pump])

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  return useMemo(() => ({ findCover, setUserCover, removeCover }), [findCover, setUserCover, removeCover])
}
