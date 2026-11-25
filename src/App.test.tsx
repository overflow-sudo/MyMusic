import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryDir } from './storage/memoryDir'
import { createSong, emptyLibrary } from './domain/library'
import { saveLibrary } from './storage/repo'

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
})
