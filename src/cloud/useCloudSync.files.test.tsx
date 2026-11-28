import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSong } from '../domain/library'
import type { Song } from '../domain/types'
import { createMemoryDir } from '../storage/memoryDir'
import { listRecordings, songDir } from '../storage/repo'
import { createFakeCloud } from './fakeCloud.testutil'
import { recordingId } from './hash'
import { clearSession, setSession } from './session'
import { getCloudStatus, resetCloudStatus } from './status'
import { useCloudSync, type SyncApi } from './useCloudSync'

const V1 = '2026-11-24_21-30-05_video.webm'
const V2 = '2026-11-25_10-00-00_ses.webm'

async function setup(opts: { busy?: boolean; tombstones?: string[] } = {}) {
  setSession({ baseUrl: 'https://example.test', token: 'dummy-token' })
  const song: Song = createSong({ title: 'A', artist: 'B', status: 'learning', bpm: 100, countInBeats: 4 }, new Date('2026-11-01T00:00:00Z'), 's1')
  const root = createMemoryDir()
  for (const n of [V1, V2]) await (await songDir(root, song)).writeFile(n, new Blob([n]))
  const cloud = createFakeCloud()
  cloud.live.add('s1')
  for (const t of opts.tombstones ?? []) cloud.tombstones.add(t)
  let local: Song[] = [song]
  let pending: string[] = []
  const api: SyncApi = {
    ...cloud.api,
    getLibrary: async () => ({ songs: [song as never] }),
    putSong: async (s) => s,
  }
  const files = {
    root,
    patchSong: vi.fn(async () => {}),
    getPendingDeletes: () => pending,
    clearPendingDeletes: (ids: string[]) => { pending = pending.filter((x) => !ids.includes(x)) },
  }
  const view = renderHook(
    ({ busy }: { busy: boolean }) =>
      useCloudSync({ ready: true, busy, revision: 0, getLocalSongs: () => local, applyMerged: (s) => { local = s }, files, makeApi: () => api }),
    { initialProps: { busy: opts.busy ?? false } },
  )
  // Real timers: hashing (crypto.subtle) settles outside fake time.
  const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  return { cloud, root, song, view, flush, setPending: (p: string[]) => { pending = p }, pending: () => pending }
}

beforeEach(() => {
  localStorage.clear()
  resetCloudStatus()
})
afterEach(() => {
  cleanup()
  clearSession()
})
const idle = () => waitFor(() => expect(getCloudStatus().state).toBe('connected'))

describe('useCloudSync with files', () => {
  it('library → recording deletes → uploads, in order; connected afterwards with no progress left', async () => {
    const h = await setup()
    h.setPending(['dead'])
    await idle()
    expect(h.cloud.log.indexOf('delete:dead')).toBeGreaterThanOrEqual(0)
    expect(h.cloud.log.indexOf('delete:dead')).toBeLessThan(h.cloud.log.indexOf('create'))
    expect(h.cloud.recordings.size).toBe(2)
    expect(h.pending()).toEqual([])
    expect(getCloudStatus()).toMatchObject({ state: 'connected', lastError: null, progress: null })
  })

  it('shows "Yükleniyor: i/n" while uploading', async () => {
    const h = await setup()
    const seen: string[] = []
    h.cloud.onPart = () => { const p = getCloudStatus().progress; if (p) seen.push(`${getCloudStatus().state} ${p}`) }
    await idle()
    expect(seen).toEqual(['syncing Yükleniyor: 1/2', 'syncing Yükleniyor: 2/2'])
  })

  it('nothing is uploaded while busy; a take starting mid-upload aborts it and the pass resumes after the take', async () => {
    const h = await setup({ busy: true })
    await h.flush()
    expect(h.cloud.log).toEqual([])

    let release!: () => void
    h.cloud.onPart = () => new Promise<void>((r) => { release = r })
    h.view.rerender({ busy: false })
    await waitFor(() => expect(h.cloud.log.filter((l) => l === 'create')).toHaveLength(1))
    h.view.rerender({ busy: true }) // take starts while the first part is in flight
    release()
    await idle()
    await h.flush()
    expect(h.cloud.recordings.size).toBe(0)
    expect(h.cloud.log.filter((l) => l === 'create')).toHaveLength(1)
    expect((await listRecordings(h.root, h.song)).map((e) => e.fileName).sort()).toEqual([V1, V2])

    h.cloud.onPart = undefined
    h.view.rerender({ busy: false })
    await waitFor(() => expect(h.cloud.recordings.size).toBe(2))
  })

  it('a server tombstone removes the local file during the pass', async () => {
    const h = await setup({ tombstones: [await recordingId('s1', V1)] })
    await idle()
    expect((await listRecordings(h.root, h.song)).map((e) => e.fileName)).toEqual([V2])
    expect(h.cloud.recordings.has(await recordingId('s1', V1))).toBe(false)
  })
})
