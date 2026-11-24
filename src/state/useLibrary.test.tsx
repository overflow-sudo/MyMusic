import '@testing-library/jest-dom/vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { act } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
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
    expect(r2.ok && r2.library.songs).toEqual([])
  })
})
