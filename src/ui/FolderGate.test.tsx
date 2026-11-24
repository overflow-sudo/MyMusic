import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../storage/folderHandle', () => ({
  getSavedHandle: vi.fn(),
  saveHandle: vi.fn(),
  pickFolder: vi.fn(),
  ensurePermission: vi.fn(),
}))
import * as fh from '../storage/folderHandle'
import App from '../App'
import FolderGate from './FolderGate'

const w = window as unknown as { showDirectoryPicker?: unknown }
const notFound = () => new DOMException('gone', 'NotFoundError')

beforeEach(() => {
  w.showDirectoryPicker = vi.fn()
  vi.mocked(fh.getSavedHandle).mockResolvedValue(null)
})
afterEach(() => {
  cleanup()
  delete w.showDirectoryPicker
  vi.resetAllMocks()
})

describe('FolderGate', () => {
  it('shows pick button without saved handle', () => {
    render(<FolderGate hasSaved={false} onPick={() => {}} onReconnect={() => {}} />)
    expect(screen.getByRole('button', { name: 'Klasör seç' })).toBeInTheDocument()
  })
  it('shows reconnect button with saved handle', () => {
    const onReconnect = vi.fn()
    render(<FolderGate hasSaved onPick={() => {}} onReconnect={onReconnect} />)
    fireEvent.click(screen.getByRole('button', { name: 'Klasöre tekrar bağlan' }))
    expect(onReconnect).toHaveBeenCalled()
  })
})

describe('App shell', () => {
  it('unsupported browser', async () => {
    delete w.showDirectoryPicker
    render(<App />)
    expect(await screen.findByText(/Chrome veya Edge gerektirir/)).toBeInTheDocument()
  })
  it('no handle -> Klasör seç', async () => {
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Klasör seç' })).toBeInTheDocument()
  })
  it("saved handle with 'prompt' permission -> reconnect", async () => {
    const handle = { queryPermission: vi.fn().mockResolvedValue('prompt') } as unknown as FileSystemDirectoryHandle
    vi.mocked(fh.getSavedHandle).mockResolvedValue(handle)
    vi.mocked(fh.ensurePermission).mockResolvedValue(false)
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Klasöre tekrar bağlan' })).toBeInTheDocument()
  })
  it('deleted folder (NotFoundError) -> gate with note, no crash', async () => {
    const handle = { getDirectoryHandle: vi.fn().mockRejectedValue(notFound()) } as unknown as FileSystemDirectoryHandle
    vi.mocked(fh.getSavedHandle).mockResolvedValue(handle)
    vi.mocked(fh.ensurePermission).mockResolvedValue(true)
    render(<App />)
    expect(await screen.findByText('Klasör bulunamadı, lütfen tekrar seç.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Klasör seç' })).toBeInTheDocument()
  })
  it('granted handle opens the library placeholder', async () => {
    const dirs = new Map<string, unknown>()
    const handle = {
      getDirectoryHandle: vi.fn(async (n: string) => {
        if (n === '.parcalar') throw notFound()
        return dirs.get(n) ?? dirs.set(n, {}).get(n)
      }),
      getFileHandle: vi.fn().mockRejectedValue(notFound()),
    } as unknown as FileSystemDirectoryHandle
    vi.mocked(fh.getSavedHandle).mockResolvedValue(handle)
    vi.mocked(fh.ensurePermission).mockResolvedValue(true)
    render(<App />)
    await waitFor(() => expect(screen.getByText('Şarkı listesi burada olacak')).toBeInTheDocument())
  })
})
