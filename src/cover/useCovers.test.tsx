import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useCallback, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSong } from '../domain/library'
import type { Song } from '../domain/types'
import { createMemoryDir } from '../storage/memoryDir'
import { songDir } from '../storage/repo'
import type { CoverHit } from './itunes'
import { useCovers } from './useCovers'

afterEach(cleanup)

const mk = (n: number, title = `Song ${n}`) =>
  createSong({ title, artist: 'Band', status: 'learning', bpm: 100, countInBeats: 4 }, new Date(2026, 10, 25), `s${n}`)

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

const hit: CoverHit = { artworkUrl: 'https://x/600x600bb.jpg' }
const jpeg = () => new Blob(['img'], { type: 'image/jpeg' })

function setup(initial: Song[], opts: { search?: (t: string, a: string) => Promise<CoverHit | null>; download?: (u: string) => Promise<Blob | null>; backfill?: boolean; failPatch?: boolean } = {}) {
  const root = createMemoryDir()
  const search = vi.fn(opts.search ?? (async () => hit))
  const download = vi.fn(opts.download ?? (async () => jpeg()))
  const patches: { id: string; patch: Partial<Song> }[] = []
  const view = renderHook(
    ({ backfill }) => {
      const [songs, setSongs] = useState(initial)
      const patchSong = useCallback(async (id: string, patch: Partial<Song>) => {
        if (opts.failPatch) throw new Error('disk')
        patches.push({ id, patch })
        setSongs((ss) => ss.map((s) => (s.id === id ? { ...s, ...patch } : s)))
      }, [])
      const covers = useCovers(root, songs, patchSong, { backfill, search, download })
      return { songs, setSongs, covers }
    },
    { initialProps: { backfill: opts.backfill ?? false } },
  )
  return { root, search, download, patches, view }
}

describe('useCovers', () => {
  it('findCover downloads, writes cover.jpg and patches the song', async () => {
    const s = mk(1)
    const { root, view, patches, search } = setup([s])
    let r: string | undefined
    await act(async () => {
      r = await view.result.current.covers.findCover(s)
    })
    expect(r).toBe('found')
    expect(search).toHaveBeenCalledWith('Song 1', 'Band')
    expect(patches).toEqual([{ id: 's1', patch: { cover: { source: 'itunes', fileName: 'cover.jpg' } } }])
    expect(await (await songDir(root, s)).readFile('cover.jpg')).not.toBeNull()
  })

  it('keeps the remote url when the image cannot be downloaded', async () => {
    const s = mk(1)
    const { view, patches } = setup([s], { download: async () => null })
    await act(async () => void (await view.result.current.covers.findCover(s)))
    expect(patches).toEqual([{ id: 's1', patch: { cover: { source: 'itunes', url: hit.artworkUrl } } }])
  })

  it("no hit → 'none' and no patch", async () => {
    const s = mk(1)
    const { view, patches } = setup([s], { search: async () => null })
    let r: string | undefined
    await act(async () => {
      r = await view.result.current.covers.findCover(s)
    })
    expect(r).toBe('none')
    expect(patches).toEqual([])
  })

  it('backfill with 5 coverless songs never runs more than 2 at once', async () => {
    const songs = [1, 2, 3, 4, 5].map((n) => mk(n))
    let active = 0
    let peak = 0
    const gates: ReturnType<typeof deferred<CoverHit | null>>[] = []
    const { search } = setup(songs, {
      backfill: true,
      search: () => {
        active++
        peak = Math.max(peak, active)
        const d = deferred<CoverHit | null>()
        gates.push(d)
        return d.promise.finally(() => active--)
      },
    })
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    while (gates.length) {
      await act(async () => gates.shift()!.resolve(null))
      await act(async () => {})
    }
    await waitFor(() => expect(search).toHaveBeenCalledTimes(5))
    while (gates.length) await act(async () => gates.shift()!.resolve(null))
    expect(peak).toBe(2)
  })

  it('a failed song is not retried on re-render; a rename makes it eligible again', async () => {
    const s = mk(1)
    const { view, search } = setup([s], { backfill: true, search: async () => null })
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
    view.rerender({ backfill: false })
    view.rerender({ backfill: true })
    act(() => view.result.current.setSongs((ss) => [...ss]))
    await act(async () => {})
    expect(search).toHaveBeenCalledTimes(1)
    act(() => view.result.current.setSongs((ss) => ss.map((x) => ({ ...x, title: 'Yeni Ad' }))))
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    expect(search).toHaveBeenLastCalledWith('Yeni Ad', 'Band')
  })

  it('an explicit find and the backfill of the same new song search only once', async () => {
    const s = mk(1)
    const { view, search } = setup([s], { backfill: true })
    await act(async () => void (await view.result.current.covers.findCover(s)))
    await act(async () => {})
    expect(search).toHaveBeenCalledTimes(1)
  })

  it("a find resolving after the user picked their own image doesn't overwrite it", async () => {
    const s = mk(1)
    const gate = deferred<CoverHit | null>()
    const { root, view, patches } = setup([s], { search: () => gate.promise })
    let found!: Promise<string>
    act(() => {
      found = view.result.current.covers.findCover(s)
    })
    await act(async () => view.result.current.covers.setUserCover(s, new File(['mine'], 'Photo.PNG', { type: 'image/png' })))
    await act(async () => {
      gate.resolve(hit)
      await found
    })
    expect(patches).toEqual([{ id: 's1', patch: { cover: { source: 'user', fileName: 'cover.png' } } }])
    expect(view.result.current.songs[0].cover).toEqual({ source: 'user', fileName: 'cover.png' })
    const names = (await (await songDir(root, s)).list()).map((e) => e.name)
    expect(names).toEqual(['cover.png'])
  })

  it('a find resolving after the song was deleted does not patch', async () => {
    const s = mk(1)
    const gate = deferred<CoverHit | null>()
    const { view, patches } = setup([s], { search: () => gate.promise })
    let found!: Promise<string>
    act(() => {
      found = view.result.current.covers.findCover(s)
    })
    act(() => view.result.current.setSongs([]))
    await act(async () => {
      gate.resolve(hit)
      await found
    })
    expect(patches).toEqual([])
  })

  it("removeCover deletes the file and patches { source: 'none' }, and backfill does not bring it back", async () => {
    const s = { ...mk(1), cover: { source: 'itunes' as const, fileName: 'cover.jpg' } }
    const { root, view, patches, search } = setup([s], { backfill: true })
    await (await songDir(root, s)).writeFile('cover.jpg', jpeg())
    await act(async () => view.result.current.covers.removeCover(s))
    expect(patches).toEqual([{ id: 's1', patch: { cover: { source: 'none' } } }])
    expect((await (await songDir(root, s)).list()).map((e) => e.name)).toEqual([])
    await act(async () => {})
    expect(search).not.toHaveBeenCalled()
  })

  it("backfill never searches a song whose cover was removed on purpose (next session too)", async () => {
    const s = { ...mk(1), cover: { source: 'none' as const } }
    const { search } = setup([s, mk(2)], { backfill: true })
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
    expect(search).toHaveBeenCalledWith('Song 2', 'Band')
  })

  it("re-find and own image still work from the 'none' state", async () => {
    const s = { ...mk(1), cover: { source: 'none' as const } }
    const { view, patches } = setup([s])
    await act(async () => void (await view.result.current.covers.findCover(s)))
    expect(patches.at(-1)).toEqual({ id: 's1', patch: { cover: { source: 'itunes', fileName: 'cover.jpg' } } })
    await act(async () => view.result.current.covers.setUserCover(view.result.current.songs[0], new File(['m'], 'a.png', { type: 'image/png' })))
    expect(patches.at(-1)).toEqual({ id: 's1', patch: { cover: { source: 'user', fileName: 'cover.png' } } })
  })

  it('removeCover resolves when deleting the file fails after the patch', async () => {
    const s = { ...mk(1), cover: { source: 'itunes' as const, fileName: 'cover.jpg' } }
    const { root, view, patches } = setup([s])
    const dir = await songDir(root, s)
    await dir.writeFile('cover.jpg', jpeg())
    dir.remove = async () => {
      throw new Error('locked')
    }
    await act(async () => expect(view.result.current.covers.removeCover(s)).resolves.toBeUndefined())
    expect(patches).toEqual([{ id: 's1', patch: { cover: { source: 'none' } } }])
  })

  it('a find started right after adding (before React re-renders) is not dropped as stale', async () => {
    const s = mk(1)
    const { view, patches } = setup([])
    // Library state already has the song, but this hook hasn't rendered with it yet.
    let r: string | undefined
    await act(async () => {
      const p = view.result.current.covers.findCover(s)
      view.result.current.setSongs([s])
      r = await p
    })
    expect(r).toBe('found')
    expect(patches).toEqual([{ id: 's1', patch: { cover: { source: 'itunes', fileName: 'cover.jpg' } } }])
  })

  it('backfill still runs after a StrictMode-style effect remount', async () => {
    const songs = [mk(1)]
    const root = createMemoryDir()
    const search = vi.fn(async () => null)
    const patchSong = async () => {}
    renderHook(() => useCovers(root, songs, patchSong, { backfill: true, search }), { reactStrictMode: true })
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
  })

  it('backfill stops starting finds while backfill is false (a song is open) and resumes when it is true again', async () => {
    const songs = [1, 2, 3, 4].map((n) => mk(n))
    const gates: ReturnType<typeof deferred<CoverHit | null>>[] = []
    const { view, search } = setup(songs, {
      backfill: true,
      search: () => {
        const d = deferred<CoverHit | null>()
        gates.push(d)
        return d.promise
      },
    })
    await waitFor(() => expect(search).toHaveBeenCalledTimes(2))
    view.rerender({ backfill: false })
    await act(async () => gates.splice(0).forEach((g) => g.resolve(null)))
    await act(async () => {})
    expect(search).toHaveBeenCalledTimes(2)
    view.rerender({ backfill: true })
    await waitFor(() => expect(search).toHaveBeenCalledTimes(4))
    await act(async () => gates.splice(0).forEach((g) => g.resolve(null)))
  })

  it('a failing patch keeps the old cover file and removes the newly written one', async () => {
    const s = { ...mk(1), cover: { source: 'user' as const, fileName: 'cover.png' } }
    const { root, view } = setup([s], { failPatch: true })
    const dir = await songDir(root, s)
    await dir.writeFile('cover.png', new Blob(['old']))
    await act(async () => {
      await expect(view.result.current.covers.findCover(s)).rejects.toThrow('disk')
    })
    expect((await dir.list()).map((e) => e.name)).toEqual(['cover.png'])
    expect(await (await dir.readFile('cover.png'))?.text()).toBe('old')
  })

  it('stray old covers are deleted only after the patch succeeds', async () => {
    const s = { ...mk(1), cover: { source: 'user' as const, fileName: 'cover.png' } }
    const { root, view } = setup([s])
    const dir = await songDir(root, s)
    await dir.writeFile('cover.png', new Blob(['old']))
    await act(async () => void (await view.result.current.covers.findCover(s)))
    expect((await dir.list()).map((e) => e.name)).toEqual(['cover.jpg'])
  })

  it.each([
    ['notes.txt', 'text/plain'],
    ['a.svg', 'image/svg+xml'],
    ['a.heic', 'image/heic'],
    ['a.png', ''],
  ])('setUserCover refuses %s (%s): nothing written, nothing patched', async (name, type) => {
    const s = mk(1)
    const { root, view, patches } = setup([s])
    let r: string | void = undefined
    await act(async () => {
      r = await view.result.current.covers.setUserCover(s, new File(['x'], name, { type }))
    })
    expect(r).toBe('unsupported')
    expect(patches).toEqual([])
    expect((await (await songDir(root, s)).list()).map((e) => e.name)).toEqual([])
  })
})
