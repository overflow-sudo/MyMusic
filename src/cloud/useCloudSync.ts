import { useCallback, useEffect, useRef, useState } from 'react'
import type { Song } from '../domain/types'
import { CloudError, createApi } from './api'
import { getSession, onSessionChange, sessionGeneration, type Session } from './session'
import { getCloudStatus, markSynced, setCloudStatus } from './status'
import { syncLibraryOnce, type LibrarySyncApi } from './syncLibrary'

export const SYNC_DEBOUNCE_MS = 2_000
export const SYNC_INTERVAL_MS = 60_000
const FAILED_TEXT = 'Eşitleme tamamlanamadı'

interface Options {
  /** The local library is loaded and usable. */
  ready: boolean
  /** A take is counting in / recording / finalizing: passes wait until it ends. */
  busy: boolean
  /** Changes on every local edit (not on applyMerged); a change schedules a pass after 2 s. */
  revision: number
  getLocalSongs(): Song[]
  applyMerged(songs: Song[]): Promise<void> | void
  /** Injectable for tests. */
  makeApi?: (s: Session) => LibrarySyncApi
}

const defaultMakeApi = (s: Session): LibrarySyncApi => createApi(s)

/** Background library sync: on mount/session, 2 s after local changes, every 60 s, on `online`, and on syncNow(). Never throws. */
export function useCloudSync({ ready, busy, revision, getLocalSongs, applyMerged, makeApi = defaultMakeApi }: Options): { syncNow(): void } {
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

  const deps = useRef({ session, ready, busy, getLocalSongs, applyMerged, makeApi })
  useEffect(() => {
    deps.current = { session, ready, busy, getLocalSongs, applyMerged, makeApi }
  })
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
      const stats = await syncLibraryOnce({ api: d.makeApi(d.session), getLocalSongs: () => deps.current.getLocalSongs(), applyMerged: (s) => deps.current.applyMerged(s) })
      // Task 11: tracks/covers → recording deletes → recording uploads continue here.
      // Re-check deps.current.busy before every upload step (a take may have started during the library step).
      if (mine()) {
        authBlocked.current = null
        setCloudStatus('connected', stats.failed > 0 ? FAILED_TEXT : null)
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
