import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryDir } from './storage/memoryDir'
import { createSong, emptyLibrary } from './domain/library'
import { loadLibrary, saveLibrary } from './storage/repo'

vi.mock('./storage/folderHandle', () => ({
  getSavedHandle: async () => ({ getDirectoryHandle: async () => ({}) }),
  ensurePermission: async () => true,
  pickFolder: vi.fn(),
  saveHandle: vi.fn(),
}))
vi.mock('./storage/fsDir', () => ({ fromHandle: () => memory }))
vi.mock('./storage/chunkWriter', () => ({ recoverPending: async () => [] }))
const search = vi.hoisted(() => vi.fn(async (_t: string, _a: string) => null))
vi.mock('./cover/itunes', async (importOriginal) => ({ ...(await importOriginal<typeof import('./cover/itunes')>()), searchCover: search }))

import App from './App'
import { resetCloudStatus } from './cloud/status'

let memory = createMemoryDir()

beforeEach(() => {
  memory = createMemoryDir()
  localStorage.clear()
  search.mockClear()
  Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: vi.fn() })
})
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'showDirectoryPicker')
})

describe('App', () => {
  it('the song list is inert while the settings dialog is open', async () => {
    render(<App />)
    const gear = await screen.findByRole('button', { name: 'Ayarlar' })
    const wrapper = gear.closest('main')!.parentElement!
    expect(wrapper).not.toHaveAttribute('inert')
    fireEvent.click(gear)
    expect(wrapper).toHaveAttribute('inert')
    fireEvent.click(screen.getByRole('button', { name: 'Vazgeç' }))
    expect(wrapper).not.toHaveAttribute('inert')
  })

  it('adding a song triggers exactly one cover search', async () => {
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: '＋ Şarkı' }))
    fireEvent.change(screen.getByLabelText('Şarkı adı'), { target: { value: 'Wonderwall' } })
    fireEvent.change(screen.getByLabelText('Sanatçı'), { target: { value: 'Oasis' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    await screen.findByText('Wonderwall')
    await waitFor(() => expect(search).toHaveBeenCalledWith('Wonderwall', 'Oasis'))
    await new Promise((r) => setTimeout(r, 20))
    expect(search).toHaveBeenCalledTimes(1)
  })

  it('backfills coverless songs from an existing library once', async () => {
    const songs = [
      createSong({ title: 'A', artist: 'X', status: 'learning', bpm: 90, countInBeats: 4 }, new Date(), 'a'),
      { ...createSong({ title: 'B', artist: 'Y', status: 'learning', bpm: 90, countInBeats: 4 }, new Date(), 'b'), cover: { source: 'user' as const, fileName: 'cover.png' } },
    ]
    await saveLibrary(memory, { ...emptyLibrary(), songs })
    render(<App />)
    await screen.findByText('X')
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
    expect(search).toHaveBeenCalledWith('A', 'X')
  })

  it('a deleted song (tombstone) never shows in the list or the counts', async () => {
    const live = createSong({ title: 'Alive', artist: 'X', status: 'learning', bpm: 90, countInBeats: 4 }, new Date(), 'a')
    const gone = { ...createSong({ title: 'Gone', artist: 'Y', status: 'learning', bpm: 90, countInBeats: 4 }, new Date(), 'b'), deletedAt: new Date().toISOString() }
    await saveLibrary(memory, { ...emptyLibrary(), songs: [live, gone] })
    render(<App />)
    await screen.findByText('Alive')
    expect(screen.queryByText('Gone')).toBeNull()
    expect(screen.getByRole('tab', { name: /Çalıştığım/ })).toHaveTextContent('1')
    // the backfill never searches a tombstone
    await waitFor(() => expect(search).toHaveBeenCalledTimes(1))
    expect(search).not.toHaveBeenCalledWith('Gone', 'Y')
  })

  it('with a stored session the first sync adopts the server songs into an empty library', async () => {
    const remote = createSong({ title: 'From Server', artist: 'Mac', status: 'learning', bpm: 90, countInBeats: 4 }, new Date('2026-11-28T10:00:00.000Z'), 'srv-1')
    localStorage.setItem('mm.cloud', JSON.stringify({ baseUrl: 'https://example.test', token: 'dummy-token' }))
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/api/library') ? new Response(JSON.stringify({ songs: [remote] }), { status: 200 }) : new Response('{}', { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      render(<App />)
      await screen.findByText('From Server')
      await waitFor(async () => {
        const r = await loadLibrary(memory)
        expect(r.ok && r.library.songs.map((s) => s.id)).toEqual(['srv-1'])
      })
    } finally {
      vi.unstubAllGlobals()
      resetCloudStatus()
    }
  })

  it('an open song deleted by a sync closes, and does not reopen when a newer copy returns', async () => {
    const base = createSong({ title: 'Shared', artist: 'Both', status: 'learning', bpm: 90, countInBeats: 4 }, new Date('2026-11-28T10:00:00.000Z'), 'sh-1')
    await saveLibrary(memory, { ...emptyLibrary(), songs: [base] })
    localStorage.setItem('mm.cloud', JSON.stringify({ baseUrl: 'https://example.test', token: 'dummy-token' }))
    let remote: unknown[] = [base]
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/library')) return new Response(JSON.stringify({ songs: remote }), { status: 200 })
      if (init?.method === 'PUT') return new Response(String(init.body), { status: 200 })
      return new Response('{}', { status: 404 })
    }))
    try {
      render(<App />)
      fireEvent.click(await screen.findByText('Shared'))
      await screen.findByRole('button', { name: 'Geri' })
      remote = [{ ...base, deletedAt: '2026-11-28T11:00:00.000Z', updatedAt: '2026-11-28T11:00:00.000Z' }]
      window.dispatchEvent(new Event('online'))
      await waitFor(() => expect(screen.queryByRole('button', { name: 'Geri' })).toBeNull())
      expect(screen.queryByText('Shared')).toBeNull()
      remote = [{ ...base, title: 'Shared again', updatedAt: '2026-11-28T12:00:00.000Z' }]
      window.dispatchEvent(new Event('online'))
      await screen.findByText('Shared again')
      expect(screen.queryByRole('button', { name: 'Geri' })).toBeNull()
    } finally {
      vi.unstubAllGlobals()
      resetCloudStatus()
    }
  })
})
