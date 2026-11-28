import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createSong, emptyLibrary, tombstoneSong, updateSong, visibleSongs } from '../domain/library'
import type { Library, Song } from '../domain/types'
import type { FsDir } from '../storage/fsDir'
import { backupBrokenLibrary, loadLibrary, saveLibrary } from '../storage/repo'

type Status = 'loading' | 'ready' | 'broken'

export function useLibrary(root: FsDir) {
  const [status, setStatus] = useState<Status>('loading')
  const [library, setLibraryState] = useState<Library>(emptyLibrary)
  const [error, setError] = useState<string | undefined>()
  // Bumped by every local change (user or automatic), not by applyMerged: the sync loop watches it.
  const [revision, setRevision] = useState(0)
  const current = useRef<Library>(library)
  const lastSaved = useRef<Library>(library)
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    let cancelled = false
    loadLibrary(root).then(
      (r) => {
        if (cancelled) return
        if (r.ok) {
          current.current = r.library
          lastSaved.current = r.library
          setLibraryState(r.library)
          setError(undefined)
          setStatus('ready')
        } else {
          setError(r.error)
          setStatus('broken')
        }
      },
      (e: unknown) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setStatus('broken')
      },
    )
    return () => {
      cancelled = true
    }
  }, [root])

  // Writes are chained so only one is in flight and later ones wait their turn.
  const commit = useCallback(
    (next: Library, opts: { fromSync?: boolean } = {}): Promise<void> => {
      if (!opts.fromSync) setRevision((r) => r + 1)
      current.current = next
      setLibraryState(next)
      const run = queue.current.then(async () => {
        try {
          await saveLibrary(root, next)
          lastSaved.current = next
        } catch (e) {
          // Roll back only if no newer commit has replaced this one meanwhile.
          if (current.current === next) {
            current.current = lastSaved.current
            setLibraryState(lastSaved.current)
          }
          throw e
        }
      })
      queue.current = run.catch(() => undefined)
      return run
    },
    [root],
  )

  const addSong = useCallback(
    async (input: Parameters<typeof createSong>[0]): Promise<Song> => {
      const song = createSong(input, new Date())
      await commit({ ...current.current, songs: [...current.current.songs, song] })
      return song
    },
    [commit],
  )
  /** `auto`: a background fill (cover/hash backfill) — keeps updatedAt so it never beats a real edit elsewhere. */
  const patchSong = useCallback(
    (id: string, patch: Partial<Song>, opts?: { auto?: boolean }) => {
      const lib = current.current
      if (!opts?.auto) return commit(updateSong(lib, id, patch, new Date()))
      return commit({
        ...lib,
        songs: lib.songs.map((s) => (s.id === id ? { ...s, ...patch, id: s.id, folderName: s.folderName, updatedAt: s.updatedAt } : s)),
      })
    },
    [commit],
  )
  // A tombstone, so the delete syncs; files stay on disk as before.
  const deleteSong = useCallback((id: string) => commit(tombstoneSong(current.current, id, new Date())), [commit])
  /** Sync loop only: replaces the song list (tombstones included) as merged; saved, but not a local change. */
  const applyMerged = useCallback(
    (songs: Song[]) => commit({ ...current.current, songs }, { fromSync: true }),
    [commit],
  )
  /** Every song including tombstones, as of now (for the sync loop). */
  const getAllSongs = useCallback(() => current.current.songs, [])
  const setSettings = useCallback(
    (p: Partial<Library['settings']>) =>
      commit({ ...current.current, settings: { ...current.current.settings, ...p } }),
    [commit],
  )
  const resetBroken = useCallback(async () => {
    await backupBrokenLibrary(root, new Date())
    const fresh = emptyLibrary()
    await commit(fresh)
    setError(undefined)
    setStatus('ready')
  }, [root, commit])

  // Consumers never see tombstones.
  const visible = useMemo(() => {
    const songs = visibleSongs(library.songs)
    return songs.length === library.songs.length ? library : { ...library, songs }
  }, [library])

  return { status, library: visible, error, revision, addSong, patchSong, deleteSong, setSettings, resetBroken, applyMerged, getAllSongs }
}
