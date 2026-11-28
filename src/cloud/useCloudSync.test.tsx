import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SongRecord } from '../../shared/api'
import type { Song } from '../domain/types'
import { CloudError } from './api'
import { createSong } from '../domain/library'
import { clearSession, setSession } from './session'
import { getCloudStatus, resetCloudStatus } from './status'
import type { LibrarySyncApi } from './syncLibrary'
import { useCloudSync } from './useCloudSync'

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((r, j) => { resolve = r; reject = j })
  return { promise, resolve, reject }
}

function setup(opts: { getLibrary?: () => Promise<{ songs: SongRecord[] }>; putSong?: (s: SongRecord) => Promise<SongRecord>; local?: Song[]; session?: boolean } = {}) {
  if (opts.session !== false) setSession({ baseUrl: 'https://example.test', token: 'dummy-token' })
  const api: LibrarySyncApi = {
    getLibrary: vi.fn(opts.getLibrary ?? (async () => ({ songs: [] }))),
    putSong: vi.fn(opts.putSong ?? (async (s: SongRecord) => s)),
  }
  const makeApi = vi.fn(() => api)
  let local: Song[] = opts.local ?? []
  const applyMerged = vi.fn(async (s: Song[]) => { local = s })
  const view = renderHook(
    ({ busy, revision }: { busy: boolean; revision: number }) =>
      useCloudSync({ ready: true, busy, revision, getLocalSongs: () => local, applyMerged, makeApi }),
    { initialProps: { busy: false, revision: 0 } },
  )
  const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0) })
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })
  return { api, makeApi, view, flush, advance, calls: () => vi.mocked(api.getLibrary).mock.calls.length }
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  resetCloudStatus()
})
afterEach(() => {
  cleanup()
  clearSession()
  vi.useRealTimers()
})

describe('useCloudSync', () => {
  it('does nothing without a session', async () => {
    const h = setup({ session: false })
    await h.advance(120_000)
    expect(h.calls()).toBe(0)
  })

  it('runs on mount: syncing → connected and marks synced', async () => {
    const d = deferred<{ songs: SongRecord[] }>()
    const h = setup({ getLibrary: () => d.promise })
    await h.flush()
    expect(h.calls()).toBe(1)
    expect(getCloudStatus().state).toBe('syncing')
    await act(async () => { d.resolve({ songs: [] }); await vi.advanceTimersByTimeAsync(0) })
    expect(getCloudStatus().state).toBe('connected')
    expect(getCloudStatus().lastSyncAt).not.toBeNull()
  })

  it('runs 2 s after the last local change (debounced)', async () => {
    const h = setup()
    await h.flush()
    expect(h.calls()).toBe(1)
    h.view.rerender({ busy: false, revision: 1 })
    await h.advance(1500)
    h.view.rerender({ busy: false, revision: 2 })
    await h.advance(1500)
    expect(h.calls()).toBe(1)
    await h.advance(500)
    expect(h.calls()).toBe(2)
  })

  it('runs every 60 s', async () => {
    const h = setup()
    await h.flush()
    await h.advance(59_000)
    expect(h.calls()).toBe(1)
    await h.advance(1_000)
    expect(h.calls()).toBe(2)
    await h.advance(60_000)
    expect(h.calls()).toBe(3)
  })

  it('runs when the browser comes back online', async () => {
    const h = setup()
    await h.flush()
    await act(async () => { window.dispatchEvent(new Event('online')); await vi.advanceTimersByTimeAsync(0) })
    expect(h.calls()).toBe(2)
  })

  it('one pass at a time; requests during a pass coalesce into one more', async () => {
    const first = deferred<{ songs: SongRecord[] }>()
    let n = 0
    const h = setup({ getLibrary: () => (n++ === 0 ? first.promise : Promise.resolve({ songs: [] })) })
    await h.flush()
    act(() => { h.view.result.current.syncNow(); h.view.result.current.syncNow() })
    await h.flush()
    expect(h.calls()).toBe(1)
    await act(async () => { first.resolve({ songs: [] }); await vi.advanceTimersByTimeAsync(0) })
    expect(h.calls()).toBe(2)
    await h.flush()
    expect(h.calls()).toBe(2)
  })

  it('skips passes while a take is running and runs one right after', async () => {
    const h = setup()
    await h.flush()
    h.view.rerender({ busy: true, revision: 0 })
    act(() => h.view.result.current.syncNow())
    await h.advance(61_000)
    expect(h.calls()).toBe(1)
    h.view.rerender({ busy: false, revision: 0 })
    await h.flush()
    expect(h.calls()).toBe(2)
  })

  it('offline → status offline, nothing thrown', async () => {
    const h = setup({ getLibrary: async () => { throw new CloudError('offline', 'Network error') } })
    await h.flush()
    expect(getCloudStatus().state).toBe('offline')
    expect(getCloudStatus().lastSyncAt).toBeNull()
  })

  it('401 → needs-login, and automatic passes stop until syncNow', async () => {
    const h = setup({ getLibrary: async () => { throw new CloudError('auth', 'Unauthorized', { status: 401 }) } })
    await h.flush()
    expect(getCloudStatus().state).toBe('needs-login')
    await h.advance(120_000)
    expect(h.calls()).toBe(1)
    act(() => h.view.result.current.syncNow())
    await h.flush()
    expect(h.calls()).toBe(2)
  })

  it('creates a fresh api after the session changes', async () => {
    const h = setup()
    await h.flush()
    act(() => setSession({ baseUrl: 'https://other.test', token: 'dummy-2' }))
    await h.flush()
    expect(h.makeApi).toHaveBeenLastCalledWith({ baseUrl: 'https://other.test', token: 'dummy-2' })
  })

  it('a refused put leaves status connected with lastError', async () => {
    const local = [createSong({ title: 'A', artist: 'B', status: 'learning', bpm: 90, countInBeats: 4 }, new Date('2026-11-28T10:00:00.000Z'), 'a')]
    const h = setup({ local, putSong: async () => { throw new CloudError('client', 'bad', { status: 400 }) } })
    await h.flush()
    expect(getCloudStatus()).toMatchObject({ state: 'connected', lastError: 'Eşitleme tamamlanamadı' })
  })

  it('after a 401, a new session alone resets needs-login and runs the automatic pass', async () => {
    let n = 0
    const h = setup({ getLibrary: async () => { if (n++ === 0) throw new CloudError('auth', 'Unauthorized', { status: 401 }); return { songs: [] } } })
    await h.flush()
    expect(getCloudStatus().state).toBe('needs-login')
    act(() => setSession({ baseUrl: 'https://example.test', token: 'dummy-new' }))
    await h.flush()
    expect(h.calls()).toBe(2)
    expect(getCloudStatus().state).toBe('connected')
    await h.advance(60_000)
    expect(h.calls()).toBe(3)
  })
})
