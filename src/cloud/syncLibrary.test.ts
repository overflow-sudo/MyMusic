import { describe, expect, it, vi } from 'vitest'
import type { SongRecord } from '../../shared/api'
import type { Song } from '../domain/types'
import { CloudError } from './api'
import { syncLibraryOnce, type LibrarySyncApi } from './syncLibrary'

const T1 = '2026-11-28T10:00:00.000Z'
const T2 = '2026-11-28T11:00:00.000Z'
const song = (id: string, updatedAt: string, extra: Partial<Song> = {}): Song => ({
  id, title: `T ${id}`, artist: 'A', status: 'learning', bpm: 90, countInBeats: 4,
  folderName: `f-${id}`, createdAt: T1, updatedAt, ...extra,
})

function harness(local: Song[], remote: Song[], put?: (s: SongRecord) => Promise<SongRecord>) {
  const state = { local }
  const api: LibrarySyncApi = {
    getLibrary: vi.fn(async () => ({ songs: remote as unknown as SongRecord[] })),
    putSong: vi.fn(put ?? (async (s: SongRecord) => s)),
  }
  const applyMerged = vi.fn(async (songs: Song[]) => { state.local = songs })
  const run = () => syncLibraryOnce({ api, getLocalSongs: () => state.local, applyMerged })
  return { state, api, applyMerged, run }
}

describe('syncLibraryOnce', () => {
  it('pushes local-newer songs and applies remote-newer ones', async () => {
    const h = harness(
      [song('a', T2, { title: 'mine' }), song('b', T1)],
      [song('a', T1), song('b', T2, { title: 'theirs' })],
    )
    const stats = await h.run()
    expect(h.state.local.map((s) => s.title)).toEqual(['mine', 'theirs'])
    expect(h.api.putSong).toHaveBeenCalledTimes(1)
    expect(vi.mocked(h.api.putSong).mock.calls[0][0]).toMatchObject({ id: 'a', title: 'mine' })
    expect(stats).toMatchObject({ pulled: 1, pushed: 1, failed: 0 })
  })

  it('first sync with an empty local library adopts the server songs', async () => {
    const remote = [song('a', T1), song('b', T1)]
    const h = harness([], remote)
    await h.run()
    expect(h.state.local).toEqual(remote)
    expect(h.api.putSong).not.toHaveBeenCalled()
  })

  it('does not call applyMerged when nothing changed', async () => {
    const h = harness([song('a', T1)], [song('a', T1)])
    await h.run()
    expect(h.applyMerged).not.toHaveBeenCalled()
  })

  it('puts sequentially', async () => {
    let active = 0
    let max = 0
    const h = harness([song('a', T1), song('b', T1), song('c', T1)], [], async (s) => {
      active++; max = Math.max(max, active)
      await new Promise((r) => setTimeout(r, 1))
      active--
      return s
    })
    await h.run()
    expect(h.api.putSong).toHaveBeenCalledTimes(3)
    expect(max).toBe(1)
  })

  it('applies the server response when it differs (server kept a newer copy)', async () => {
    const h = harness([song('a', T2, { title: 'mine' })], [], async () => song('a', '2026-11-28T12:00:00.000Z', { title: 'server' }) as unknown as SongRecord)
    await h.run()
    expect(h.state.local[0].title).toBe('server')
  })

  it('a local edit made while the push was in flight is not lost', async () => {
    const h = harness([song('a', T1, { title: 'first' })], [], async (s) => {
      h.state.local = [song('a', T2, { title: 'edited meanwhile' })]
      return s
    })
    await h.run()
    expect(h.state.local[0].title).toBe('edited meanwhile')
  })

  it('a failing put (non-network) is counted and the rest continue', async () => {
    const h = harness([song('a', T1), song('b', T1)], [], async (s) => {
      if (s.id === 'a') throw new CloudError('client', 'bad', { status: 400 })
      return s
    })
    const stats = await h.run()
    expect(stats).toMatchObject({ pushed: 1, failed: 1 })
  })

  it('offline / auth errors abort the pass', async () => {
    const h = harness([song('a', T1), song('b', T1)], [], async () => { throw new CloudError('offline', 'x') })
    await expect(h.run()).rejects.toMatchObject({ kind: 'offline' })
    expect(h.api.putSong).toHaveBeenCalledTimes(1)
  })

  it('invalid server records are ignored', async () => {
    const h = harness([], [song('a', T1), { id: 'bad' } as unknown as Song])
    await h.run()
    expect(h.state.local.map((s) => s.id)).toEqual(['a'])
  })

  it('a local tombstone with a cover the server tombstone lacks is not re-put every pass', async () => {
    const local = song('a', T1, { deletedAt: T1, cover: { source: 'itunes', fileName: 'cover.jpg' } })
    const h = harness([local], [song('a', T1, { deletedAt: T1 })])
    await h.run()
    await h.run()
    expect(h.api.putSong).not.toHaveBeenCalled()
  })
})
