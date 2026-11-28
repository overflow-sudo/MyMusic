import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSong } from '../domain/library'
import { createMemoryDir } from '../storage/memoryDir'
import { songDir } from '../storage/repo'
import type { FsDir } from '../storage/fsDir'
import RecordingList from './RecordingList'

const urlApi = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL }
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
  Object.assign(URL, urlApi)
})

const song = createSong({ title: 'Wonderwall', artist: 'Oasis', status: 'learning', bpm: 87, countInBeats: 4 }, new Date(), 's1')
const A = '2026-11-24_21-30-00_video.webm'
const B = '2026-11-23_09-05-00_ses.webm'

async function setup(onChanged = vi.fn(), wrap?: (r: FsDir) => FsDir) {
  const mem = createMemoryDir()
  const dir = await songDir(mem, song)
  await dir.writeFile(A, 'aaa')
  await dir.writeFile(B, 'bbb')
  const root = wrap ? wrap(mem) : mem
  render(<><h3 tabIndex={-1}>Kayıtlar</h3><RecordingList root={root} song={song} onChanged={onChanged} /></>)
  await screen.findAllByRole('listitem')
  return { root: mem, dir, onChanged }
}
const rows = () => screen.getAllByRole('listitem')

describe('recording actions', () => {
  it('renders İndir and Sil per row, no Paylaş', async () => {
    await setup()
    for (const r of rows()) {
      expect(within(r).getByRole('button', { name: 'İndir' })).toHaveAttribute('title', 'İndir')
      expect(within(r).getByRole('button', { name: 'Sil' })).toHaveAttribute('title', 'Sil')
    }
    expect(screen.queryByRole('button', { name: 'Paylaş' })).toBeNull()
  })

  it('İndir clicks an anchor with the file name and revokes the URL', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:dl')
    URL.revokeObjectURL = vi.fn()
    const clicked: { download: string; href: string; inDom: boolean }[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href, inDom: this.isConnected })
    })
    await setup()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'İndir' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(clicked).toHaveLength(1)
    expect(clicked[0].download).toBe(A)
    expect(clicked[0].href).toBe('blob:dl')
    expect(screen.queryByRole('region')).toBeNull() // row stays closed: no player toggled
    expect(document.querySelector('[data-player]')).toBeNull()
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:dl')
    await vi.advanceTimersByTimeAsync(1000)
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:dl')
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('Sil asks inline (no window.confirm); Vazgeç and Esc cancel', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const { onChanged } = await setup()
    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Sil' }))
    expect(within(rows()[0]).getByText('Bu kayıt silinsin mi?')).toBeInTheDocument()
    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Vazgeç' }))
    expect(screen.queryByText('Bu kayıt silinsin mi?')).toBeNull()
    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Sil' }))
    fireEvent.keyDown(within(rows()[0]).getByRole('button', { name: 'Vazgeç' }), { key: 'Escape' })
    expect(screen.queryByText('Bu kayıt silinsin mi?')).toBeNull()
    expect(rows()).toHaveLength(2)
    expect(onChanged).not.toHaveBeenCalled()
    expect(confirm).not.toHaveBeenCalled()
  })

  it('confirming deletes the file, refreshes the list, notifies, and focuses the next row', async () => {
    const { dir, onChanged } = await setup()
    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Sil' }))
    fireEvent.click(within(rows()[0]).getByText('Sil', { selector: 'button.danger' }))
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(await dir.readFile(A)).toBeNull()
    expect(await dir.readFile(B)).not.toBeNull()
    expect(onChanged).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(within(rows()[0]).getByRole('button', { name: /23 Kas/ })).toHaveFocus())
  })

  it('deleting the last row focuses the list heading', async () => {
    const mem = createMemoryDir()
    await (await songDir(mem, song)).writeFile(A, 'a')
    render(<><h3 id="h" tabIndex={-1}>Kayıtlar</h3><RecordingList root={mem} song={song} headingId="h" /></>)
    await screen.findAllByRole('listitem')
    fireEvent.click(screen.getByRole('button', { name: 'Sil' }))
    fireEvent.click(screen.getByText('Sil', { selector: 'button.danger' }))
    await screen.findByText('Henüz kayıt yok.')
    expect(screen.getByRole('heading', { name: 'Kayıtlar' })).toHaveFocus()
  })

  it('closes the open player when its row is deleted', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:p')
    URL.revokeObjectURL = vi.fn()
    await setup()
    fireEvent.click(within(rows()[0]).getByRole('button', { name: /24 Kas/ }))
    await waitFor(() => expect(document.querySelector('[data-player]')).not.toBeNull())
    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Sil' }))
    fireEvent.click(within(rows()[0]).getByText('Sil', { selector: 'button.danger' }))
    await waitFor(() => expect(rows()).toHaveLength(1))
    expect(document.querySelector('[data-player]')).toBeNull()
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:p'))
  })

  it('action clicks do not toggle the row player', async () => {
    await setup()
    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Sil' }))
    expect(within(rows()[0]).getByRole('button', { name: /24 Kas/ })).toHaveAttribute('aria-expanded', 'false')
    expect(document.querySelector('[data-player]')).toBeNull()
  })

  it('a failing delete shows "Silinemedi, tekrar dene." and keeps the row', async () => {
    const { onChanged } = await setup(vi.fn(), (m) => ({
      ...m,
      dir: async (n, o) => {
        const d = await m.dir(n, o)
        if (!d) return d
        return {
          ...d,
          dir: async (n2, o2) => {
            const sd = await d.dir(n2, o2)
            return sd && { ...sd, remove: async () => { throw new Error('locked') } }
          },
        }
      },
    }))
    fireEvent.click(within(rows()[0]).getByRole('button', { name: 'Sil' }))
    fireEvent.click(within(rows()[0]).getByText('Sil', { selector: 'button.danger' }))
    expect(await screen.findByText('Silinemedi, tekrar dene.')).toBeInTheDocument()
    expect(rows()).toHaveLength(2)
    expect(onChanged).not.toHaveBeenCalled()
  })
})
