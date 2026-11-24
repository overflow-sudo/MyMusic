import { useCallback, useEffect, useRef, useState } from 'react'
import { createSong, emptyLibrary, removeSong, updateSong } from '../domain/library'
import type { Library, Song } from '../domain/types'
import type { FsDir } from '../storage/fsDir'
import { backupBrokenLibrary, loadLibrary, saveLibrary } from '../storage/repo'

type Status = 'loading' | 'ready' | 'broken'

export function useLibrary(root: FsDir) {
  const [status, setStatus] = useState<Status>('loading')
  const [library, setLibraryState] = useState<Library>(emptyLibrary)
  const [error, setError] = useState<string | undefined>()
  const current = useRef<Library>(library)
  const queue = useRef<Promise<unknown>>(Promise.resolve())

  useEffect(() => {
    let cancelled = false
    loadLibrary(root).then(
      (r) => {
        if (cancelled) return
        if (r.ok) {
          current.current = r.library
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
    (next: Library): Promise<void> => {
      current.current = next
      setLibraryState(next)
      const run = queue.current.then(() => saveLibrary(root, next))
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
  const patchSong = useCallback(
    (id: string, patch: Partial<Song>) => commit(updateSong(current.current, id, patch, new Date())),
    [commit],
  )
  const deleteSong = useCallback((id: string) => commit(removeSong(current.current, id)), [commit])
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

  return { status, library, error, addSong, patchSong, deleteSong, setSettings, resetBroken }
}
