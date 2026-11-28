import { useCallback, useEffect, useRef, useState } from 'react'
import type { Song } from '../domain/types'
import { CloudError, createApi } from './api'
import { getSession, onSessionChange, sessionGeneration, type Session } from './session'
import type { FsDir } from '../storage/fsDir'
import { getCloudStatus, markSynced, setCloudProgress, setCloudStatus } from './status'
import { pendingDeleteNote } from './deleteRecording'
import { syncFilesOnce, type FilesSyncApi } from './syncFiles'
import { syncLibraryOnce, type LibrarySyncApi } from './syncLibrary'
import { syncRecordingsOnce, type RecordingsSyncApi } from './syncRecordings'

export const SYNC_DEBOUNCE_MS = 2_000
export const SYNC_INTERVAL_MS = 60_000
const FAILED_TEXT = 'Eşitleme tamamlanamadı'

/** What a pass needs from the server; the file/recording methods are used only with `files`. */
export type SyncApi = LibrarySyncApi & Partial<FilesSyncApi & RecordingsSyncApi>
type FullApi = LibrarySyncApi & FilesSyncApi & RecordingsSyncApi

export interface FileSyncOptions {
  root: FsDir
  /** Hash backfill (always { auto: true }). */
  patchSong(id: string, patch: Partial<Song>, opts: { auto: true }): Promise<void>
  getPendingDeletes(): string[]
  clearPendingDeletes(ids: string[]): Promise<void> | void
  /** A pass removed local recording files (server tombstones): lists/counts should reload. */
  onRecordingsDeleted?(): void
}

interface Options {
  /** The local library is loaded and usable. */
  ready: boolean
  /** A take is counting in / recording / finalizing: passes wait until it ends. */
  busy: boolean
  /** Changes on every local edit (not on applyMerged); a change schedules a pass after 2 s. */
  revision: number
  getLocalSongs(): Song[]
  applyMerged(songs: Song[]): Promise<void> | void
  /** Tracks/covers and recordings after the library step; without it a pass syncs the library only. */
  files?: FileSyncOptions
  /** Injectable for tests. */
  makeApi?: (s: Session) => SyncApi
}

const defaultMakeApi = (s: Session): SyncApi => createApi(s)

/** Background library sync: on mount/session, 2 s after local changes, every 60 s, on `online`, and on syncNow(). Never throws. */
export function useCloudSync({ ready, busy, revision, getLocalSongs, applyMerged, files, makeApi = defaultMakeApi }: Options): { syncNow(): void } {
  const [session, setSessionState] = useState(getSession)
  // Session generation that got a 401: automatic passes wait for a new session (or syncNow).
  const authBlocked = useRef<number | null>(null)
  useEffect(
    () =>
      onSessionChange(() => {
        const next = getSession()
        // A new login clears needs-login here, not only in CloudSettings, so the automatic pass runs.
        if (next && getCloudStatus().state === 'needs-login') setCloudStatus('connected')
        setSessionState(next)
      }),
    [],
  )

  const deps = useRef({ session, ready, busy, getLocalSongs, applyMerged, files, makeApi })
  useEffect(() => {
    deps.current = { session, ready, busy, getLocalSongs, applyMerged, files, makeApi }
  })
  // Aborts the running file transfer when a take starts.
  const transfer = useRef<AbortController | null>(null)
  useEffect(() => {
    if (busy) transfer.current?.abort()
  }, [busy])
  // Files known to be on the server (per session) and file hashes (per folder): keep passes cheap.
  const confirmed = useRef({ gen: -1, set: new Set<string>() })
  const hashCache = useRef(new Map<string, string>())
  const running = useRef(false)
  const again = useRef(false) // a pass was asked for while one ran or while busy
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const pass = useCallback(async function pass(manual: boolean): Promise<void> {
    const d = deps.current
    if (!alive.current || !d.session || !d.ready) return
    // After a 401 only the user (Şimdi eşitle / new login) starts a pass.
    if (!manual && authBlocked.current === sessionGeneration()) return
    if (running.current || d.busy) {
      again.current = true
      return
    }
    running.current = true
    again.current = false
    const gen = sessionGeneration()
    const mine = () => sessionGeneration() === gen
    setCloudStatus('syncing')
    try {
      const api = d.makeApi(d.session)
      const getLocalSongs = () => deps.current.getLocalSongs()
      const stats = await syncLibraryOnce({ api, getLocalSongs, applyMerged: (s) => deps.current.applyMerged(s) })
      let failed = stats.failed > 0
      let note: string | null = null
      const f = deps.current.files
      if (f && mine()) {
        const full = api as FullApi
        const ac = new AbortController()
        transfer.current = ac
        // Re-checked before every transfer: a take may start at any point of the pass.
        const shouldStop = () => deps.current.busy || !alive.current || !mine()
        if (confirmed.current.gen !== gen) confirmed.current = { gen, set: new Set() }
        try {
          const fs = await syncFilesOnce({
            api: full, root: f.root, getLocalSongs, shouldStop, signal: ac.signal,
            patchSong: (id, patch, o) => (deps.current.files ?? f).patchSong(id, patch, o),
            confirmed: confirmed.current.set, hashCache: hashCache.current,
            onProgress: (i, n) => mine() && setCloudProgress(`Dosyalar: ${i}/${n}`),
          })
          failed ||= fs.failed > 0
          note = fs.notes[0] ?? null
          let stopped = fs.stopped
          if (!stopped && mine()) {
            const rs = await syncRecordingsOnce({
              api: full, root: f.root, getLocalSongs, shouldStop, signal: ac.signal,
              getPendingDeletes: () => (deps.current.files ?? f).getPendingDeletes(),
              clearPendingDeletes: (ids) => (deps.current.files ?? f).clearPendingDeletes(ids),
              allowUploads: !fs.rateLimited,
              onProgress: (i, n) => mine() && setCloudProgress(`Yükleniyor: ${i}/${n}`),
            })
            failed ||= rs.failed > 0
            stopped = rs.stopped
            if (rs.localDeleted > 0 && mine()) (deps.current.files ?? f).onRecordingsDeleted?.()
          }
          // Stopped for a take: finish after it ends.
          if (stopped) again.current = true
        } finally {
          if (transfer.current === ac) transfer.current = null
          setCloudProgress(null)
        }
      }
      if (mine()) {
        authBlocked.current = null
        setCloudStatus('connected', failed ? FAILED_TEXT : note ?? pendingDeleteNote())
        markSynced()
      }
    } catch (e) {
      if (mine()) {
        if (e instanceof CloudError && e.kind === 'auth') {
          authBlocked.current = gen
          setCloudStatus('needs-login')
        }
        else if (e instanceof CloudError && e.kind === 'offline') setCloudStatus('offline', getCloudStatus().lastError)
        else setCloudStatus('connected', FAILED_TEXT)
      }
    } finally {
      running.current = false
    }
    if (again.current && alive.current && !deps.current.busy) void pass(false)
  }, [])

  const enabled = !!session && ready

  // Mount, new session, library became ready.
  useEffect(() => {
    if (enabled) void pass(false)
  }, [enabled, session, pass])

  // Debounced after local changes (the first value is the load, not a change).
  const firstRevision = useRef(revision)
  useEffect(() => {
    if (!enabled || revision === firstRevision.current) return
    const t = setTimeout(() => void pass(false), SYNC_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [enabled, revision, pass])

  useEffect(() => {
    if (!enabled) return
    const t = setInterval(() => void pass(false), SYNC_INTERVAL_MS)
    const onOnline = () => void pass(false)
    window.addEventListener('online', onOnline)
    return () => {
      clearInterval(t)
      window.removeEventListener('online', onOnline)
    }
  }, [enabled, pass])

  // A take just ended: run the pass that was skipped.
  useEffect(() => {
    if (!busy && again.current) void pass(false)
  }, [busy, pass])

  return { syncNow: useCallback(() => void pass(true), [pass]) }
}
