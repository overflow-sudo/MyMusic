import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../storage/folderHandle', () => ({
  getSavedHandle: vi.fn(),
  saveHandle: vi.fn(),
  pickFolder: vi.fn(),
  ensurePermission: vi.fn(),
}))
vi.mock('../storage/chunkWriter', () => ({ recoverPending: vi.fn() }))
import * as fh from '../storage/folderHandle'
import { recoverPending } from '../storage/chunkWriter'
import App from '../App'
import FolderGate from './FolderGate'

const w = window as unknown as { showDirectoryPicker?: unknown }
const notFound = () => new DOMException('gone', 'NotFoundError')

const okHandle = () =>
  ({
    getDirectoryHandle: vi.fn(async () => ({})),
    getFileHandle: vi.fn().mockRejectedValue(notFound()),
  }) as unknown as FileSystemDirectoryHandle

beforeEach(() => {
  vi.mocked(recoverPending).mockResolvedValue([])
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
  it('denied reconnect shows feedback', async () => {
    const handle = {} as FileSystemDirectoryHandle
    vi.mocked(fh.getSavedHandle).mockResolvedValue(handle)
    vi.mocked(fh.ensurePermission).mockResolvedValueOnce(false).mockResolvedValueOnce(false)
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Klasöre tekrar bağlan' }))
    expect(await screen.findByText('Klasöre erişim izni verilmedi.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Klasöre tekrar bağlan' })).toBeInTheDocument()
  })
  it('pick failure shows a note', async () => {
    vi.mocked(fh.pickFolder).mockRejectedValue(new Error('boom'))
    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: 'Klasör seç' }))
    expect(await screen.findByText('Klasör seçilemedi, lütfen tekrar dene.')).toBeInTheDocument()
  })
  it('recoverPending failure keeps reconnect offered', async () => {
    vi.mocked(recoverPending).mockRejectedValue(new Error('io'))
    vi.mocked(fh.getSavedHandle).mockResolvedValue(okHandle())
    vi.mocked(fh.ensurePermission).mockResolvedValue(true)
    render(<App />)
    expect(await screen.findByRole('button', { name: 'Klasöre tekrar bağlan' })).toBeInTheDocument()
  })
  it('shows toast for recovered recordings', async () => {
    vi.mocked(recoverPending).mockResolvedValue(['a.webm', 'b.webm'])
    vi.mocked(fh.getSavedHandle).mockResolvedValue(okHandle())
    vi.mocked(fh.ensurePermission).mockResolvedValue(true)
    render(<App />)
    expect(await screen.findByText('2 yarım kayıt kurtarıldı')).toBeInTheDocument()
    expect(screen.getByText('Şarkı listesi burada olacak')).toBeInTheDocument()
  })
})
