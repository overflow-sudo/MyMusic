import '@testing-library/jest-dom/vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FsDir } from '../storage/fsDir'
import { createMemoryDir } from '../storage/memoryDir'
import { loadLibrary } from '../storage/repo'
import { useLibrary } from './useLibrary'

afterEach(cleanup)
const input = { title: 'Wonderwall', artist: 'Oasis', status: 'learning' as const, bpm: 87, countInBeats: 4 }

describe('useLibrary', () => {
  it('corrupt file -> broken, file untouched', async () => {
    const root = createMemoryDir()
    await root.writeFile('mymusic.json', '{oops')
    const { result } = renderHook(() => useLibrary(root))
    await waitFor(() => expect(result.current.status).toBe('broken'))
    expect(result.current.error).toBeTruthy()
    expect(await (await root.readFile('mymusic.json'))!.text()).toBe('{oops')
  })

  it('resetBroken backs up and starts empty', async () => {
    const root = createMemoryDir()
    await root.writeFile('mymusic.json', '{oops')
    const { result } = renderHook(() => useLibrary(root))
    await waitFor(() => expect(result.current.status).toBe('broken'))
    await act(() => result.current.resetBroken())
    expect(result.current.status).toBe('ready')
    const names = (await root.list()).map((e) => e.name)
    const backup = names.find((n) => n.startsWith('mymusic.broken-'))!
    expect(await (await root.readFile(backup))!.text()).toBe('{oops')
    const r = await loadLibrary(root)
    expect(r.ok && r.library.songs).toEqual([])
  })

  it('addSong persists to disk', async () => {
    const root = createMemoryDir()
    const { result } = renderHook(() => useLibrary(root))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    let song!: Awaited<ReturnType<typeof result.current.addSong>>
    await act(async () => {
      song = await result.current.addSong(input)
    })
    const r = await loadLibrary(root)
    expect(r.ok && r.library.songs.map((s) => s.id)).toEqual([song.id])
    expect(result.current.library.songs).toHaveLength(1)
  })

  it('rapid edits are serialized and the last one wins', async () => {
    const root = createMemoryDir()
    const { result } = renderHook(() => useLibrary(root))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    let song!: Awaited<ReturnType<typeof result.current.addSong>>
    await act(async () => {
      song = await result.current.addSong(input)
    })
    await act(async () => {
      await Promise.all([
        result.current.patchSong(song.id, { bpm: 90 }),
        result.current.patchSong(song.id, { bpm: 100 }),
        result.current.setSettings({ latencyCompensationMs: 42 }),
      ])
    })
    const r = await loadLibrary(root)
    expect(r.ok && r.library.songs[0].bpm).toBe(100)
    expect(r.ok && r.library.settings.latencyCompensationMs).toBe(42)
    await act(() => result.current.deleteSong(song.id))
    const r2 = await loadLibrary(root)
    expect(r2.ok && r2.library.songs.filter((s) => !s.deletedAt)).toEqual([])
  })

  function flaky(root: FsDir) {
    const state = { fail: false }
    const wrapped: FsDir = {
      ...root,
      writeFile: async (name, data) => {
        if (state.fail && name === 'mymusic.json') throw new Error('disk')
        return root.writeFile(name, data)
      },
    }
    return { wrapped, state }
  }

  it('failed addSong leaves no song; retry yields exactly one on disk and in state', async () => {
    const mem = createMemoryDir()
    const { wrapped, state } = flaky(mem)
    const { result } = renderHook(() => useLibrary(wrapped))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    state.fail = true
    await act(async () => {
      await expect(result.current.addSong(input)).rejects.toThrow('disk')
    })
    expect(result.current.library.songs).toHaveLength(0)
    state.fail = false
    await act(async () => {
      await result.current.addSong(input)
    })
    expect(result.current.library.songs).toHaveLength(1)
    const r = await loadLibrary(mem)
    expect(r.ok && r.library.songs).toHaveLength(1)
  })

  it('failed patchSong reverts state to the previous value', async () => {
    const mem = createMemoryDir()
    const { wrapped, state } = flaky(mem)
    const { result } = renderHook(() => useLibrary(wrapped))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    let song!: Awaited<ReturnType<typeof result.current.addSong>>
    await act(async () => {
      song = await result.current.addSong(input)
    })
    state.fail = true
    await act(async () => {
      await expect(result.current.patchSong(song.id, { bpm: 150 })).rejects.toThrow('disk')
    })
    expect(result.current.library.songs[0].bpm).toBe(87)
    state.fail = false
    await act(() => result.current.setSettings({ latencyCompensationMs: 10 }))
    const r = await loadLibrary(mem)
    expect(r.ok && r.library.songs[0].bpm).toBe(87)
  })

  async function ready(root = createMemoryDir()) {
    const view = renderHook(() => useLibrary(root))
    await waitFor(() => expect(view.result.current.status).toBe('ready'))
    let song!: Awaited<ReturnType<typeof view.result.current.addSong>>
    await act(async () => {
      song = await view.result.current.addSong(input)
    })
    return { root, result: view.result, song }
  }

  it('an auto patch keeps updatedAt; a user patch bumps it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      vi.setSystemTime(new Date('2026-11-28T10:00:00.000Z'))
      const { root, result, song } = await ready()
      vi.setSystemTime(new Date('2026-11-28T11:00:00.000Z'))
      await act(() => result.current.patchSong(song.id, { cover: { source: 'itunes', fileName: 'cover.jpg' } }, { auto: true }))
      expect(result.current.library.songs[0].updatedAt).toBe('2026-11-28T10:00:00.000Z')
      expect(result.current.library.songs[0].cover).toEqual({ source: 'itunes', fileName: 'cover.jpg' })
      const r = await loadLibrary(root)
      expect(r.ok && r.library.songs[0].updatedAt).toBe('2026-11-28T10:00:00.000Z')
      await act(() => result.current.patchSong(song.id, { bpm: 99 }))
      expect(result.current.library.songs[0].updatedAt).toBe('2026-11-28T11:00:00.000Z')
    } finally {
      vi.useRealTimers()
    }
  })

  it('deleteSong writes a tombstone that consumers never see', async () => {
    const { root, result, song } = await ready()
    await act(() => result.current.deleteSong(song.id))
    expect(result.current.library.songs).toEqual([])
    const all = result.current.getAllSongs()
    expect(all).toHaveLength(1)
    expect(all[0].deletedAt).toBe(all[0].updatedAt)
    const r = await loadLibrary(root)
    expect(r.ok && r.library.songs[0].deletedAt).toBeTruthy()
  })

  it('a tombstone on disk is hidden after load', async () => {
    const root = createMemoryDir()
    const { result, song } = await ready(root)
    await act(() => result.current.deleteSong(song.id))
    cleanup()
    const again = renderHook(() => useLibrary(root))
    await waitFor(() => expect(again.result.current.status).toBe('ready'))
    expect(again.result.current.library.songs).toEqual([])
  })

  it('local edits bump revision; applyMerged saves without bumping it', async () => {
    const { root, result, song } = await ready()
    const rev = result.current.revision
    await act(() => result.current.patchSong(song.id, { bpm: 91 }))
    expect(result.current.revision).toBe(rev + 1)
    const remote = { ...song, id: 'remote-1', title: 'From server' }
    await act(() => result.current.applyMerged([...result.current.getAllSongs(), remote]))
    expect(result.current.revision).toBe(rev + 1)
    expect(result.current.library.songs.map((s) => s.title)).toEqual(['Wonderwall', 'From server'])
    const r = await loadLibrary(root)
    expect(r.ok && r.library.songs).toHaveLength(2)
  })

  it('an auto patch on a tombstoned song does nothing', async () => {
    const { root, result, song } = await ready()
    await act(() => result.current.deleteSong(song.id))
    const before = result.current.getAllSongs()
    const rev = result.current.revision
    await act(() => result.current.patchSong(song.id, { cover: { source: 'itunes', fileName: 'cover.jpg' } }, { auto: true }))
    expect(result.current.getAllSongs()).toBe(before)
    expect(result.current.revision).toBe(rev)
    const r = await loadLibrary(root)
    expect(r.ok && r.library.songs[0].cover).toBeUndefined()
  })
})
