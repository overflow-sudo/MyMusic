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

function setup(initial: Song[], opts: { search?: (t: string, a: string) => Promise<CoverHit | null>; download?: (u: string) => Promise<Blob | null>; backfill?: boolean } = {}) {
  const root = createMemoryDir()
  const search = vi.fn(opts.search ?? (async () => hit))
  const download = vi.fn(opts.download ?? (async () => jpeg()))
  const patches: { id: string; patch: Partial<Song> }[] = []
  const view = renderHook(
    ({ backfill }) => {
      const [songs, setSongs] = useState(initial)
      const patchSong = useCallback(async (id: string, patch: Partial<Song>) => {
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

  it('removeCover deletes the file and clears the field, and backfill does not bring it back', async () => {
    const s = { ...mk(1), cover: { source: 'itunes' as const, fileName: 'cover.jpg' } }
    const { root, view, patches, search } = setup([s], { backfill: true })
    await (await songDir(root, s)).writeFile('cover.jpg', jpeg())
    await act(async () => view.result.current.covers.removeCover(s))
    expect(patches).toEqual([{ id: 's1', patch: { cover: undefined } }])
    expect((await (await songDir(root, s)).list()).map((e) => e.name)).toEqual([])
    await act(async () => {})
    expect(search).not.toHaveBeenCalled()
  })
})
