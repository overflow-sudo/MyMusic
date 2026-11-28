import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RecordingInfo, RecordingListItem } from '../../shared/api'
import { createSong } from '../domain/library'
import { recordingId } from '../cloud/hash'
import { createMemoryDir } from '../storage/memoryDir'
import { songDir } from '../storage/repo'
import RecordingList, { type RecordingCloud } from './RecordingList'

const urlApi = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL }
const song = createSong({ title: 'Wonderwall', artist: 'Oasis', status: 'learning', bpm: 87, countInBeats: 4 }, new Date(), 's1')
const LOCAL = '2026-11-24_18-30-00_ses.webm'
const BOTH = '2026-11-25_18-30-00_video.webm'
const CLOUD = '2026-11-20_10-00-00_video.webm'

async function info(fileName: string, extra: Partial<RecordingInfo> = {}): Promise<RecordingInfo> {
  return {
    id: await recordingId(song.id, fileName), songId: song.id, kind: fileName.includes('video') ? 'video' : 'ses',
    recordedAt: '2026-11-20T10:00:00.000Z', fileName, size: 10, durationSec: 61, status: 'ready',
    songTitle: song.title, songArtist: song.artist, shared: false, ...extra,
  }
}

interface Opts { local?: string[]; remote?: RecordingListItem[]; passes?: number; syncing?: boolean }
async function setup(o: Opts = {}) {
  const root = createMemoryDir()
  const dir = await songDir(root, song)
  for (const f of o.local ?? []) await dir.writeFile(f, new File(['x'], f))
  const api = {
    getRecordings: vi.fn(async () => o.remote ?? []),
    getRecordingUrl: vi.fn(async (id: string, opt?: { download?: boolean }) => ({ url: `https://srv.test/files/rec/${id}${opt?.download ? '?dl=1' : ''}` })),
    deleteRecording: vi.fn(async () => undefined),
    shareRecording: vi.fn(async () => ({ url: 'https://srv.test/r/TOKEN' })),
    unshareRecording: vi.fn(async () => undefined),
  }
  const send = vi.fn(async () => undefined)
  const prepareDelete = vi.fn(async () => ({ cancel: async () => undefined, send }))
  const mk = (passes = o.passes ?? 0, syncing = o.syncing ?? false): RecordingCloud => ({ prepareDelete, api, passes, syncing })
  const view = render(<RecordingList root={root} song={song} cloud={mk()} />)
  return { root, api, prepareDelete, send, mk, view }
}
const rowOf = (file: string) => document.querySelector<HTMLElement>(`[data-file="${file}"]`)!.closest('li')!

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:local')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Object.assign(URL, urlApi)
})

describe('merged recordings list', () => {
  it('shows local, cloud-only and both rows with status text', async () => {
    await setup({ local: [LOCAL, BOTH], remote: [await info(BOTH), await info(CLOUD)] })
    await screen.findByText('Yalnız bulutta')
    expect(within(rowOf(LOCAL)).getByText('Yalnız bu bilgisayarda')).toBeInTheDocument()
    expect(within(rowOf(BOTH)).getByText('Bulutta')).toBeInTheDocument()
    expect(within(rowOf(CLOUD)).getByText('Yalnız bulutta')).toBeInTheDocument()
    expect(document.querySelectorAll('.recording')).toHaveLength(3)
  })

  it('local-only row shows "Yükleniyor…" while a pass runs, and "Hazırlanıyor…" for processing', async () => {
    await setup({ local: [LOCAL, BOTH], remote: [await info(BOTH, { status: 'processing' })], syncing: true })
    await screen.findByText('Hazırlanıyor…')
    expect(within(rowOf(LOCAL)).getByText('Yükleniyor…')).toBeInTheDocument()
  })

  it('never shows tombstones', async () => {
    const id = await recordingId(song.id, CLOUD)
    await setup({ remote: [{ id, deleted: true }] })
    await waitFor(() => expect(screen.getByText('Henüz kayıt yok.')).toBeInTheDocument())
  })

  it('refetches after a pass finishes', async () => {
    const { api, mk, view, root } = await setup({ local: [LOCAL] })
    await screen.findByText('Yalnız bu bilgisayarda')
    api.getRecordings.mockResolvedValue([await info(LOCAL)])
    view.rerender(<RecordingList root={root} song={song} cloud={mk(1)} />)
    await screen.findByText('Bulutta')
    expect(api.getRecordings).toHaveBeenCalledTimes(2)
  })

  it('without a session nothing changes: no icons, no Paylaş', async () => {
    const root = createMemoryDir()
    await (await songDir(root, song)).writeFile(LOCAL, new File(['x'], LOCAL))
    render(<RecordingList root={root} song={song} />)
    await screen.findByText('ses')
    expect(screen.queryByText('Yalnız bu bilgisayarda')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Paylaş' })).toBeNull()
  })
})

describe('play', () => {
  it('cloud-only plays from a signed URL', async () => {
    const { api } = await setup({ remote: [await info(CLOUD)] })
    fireEvent.click(await screen.findByText('video'))
    await waitFor(() => expect(api.getRecordingUrl).toHaveBeenCalledWith(expect.any(String)))
    await waitFor(() => expect(document.querySelector('video')).toHaveAttribute('src', expect.stringContaining('https://srv.test/files/rec/')))
  })
  it('local file plays without asking the server', async () => {
    const { api } = await setup({ local: [LOCAL], remote: [await info(LOCAL)] })
    fireEvent.click(await screen.findByText('ses'))
    await waitFor(() => expect(document.querySelector('audio')).toHaveAttribute('src', 'blob:local'))
    expect(api.getRecordingUrl).not.toHaveBeenCalled()
  })
})

describe('İndir', () => {
  it('cloud-only: navigates a temporary link to the download URL', async () => {
    const { api } = await setup({ remote: [await info(CLOUD)] })
    const clicks: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this) })
    fireEvent.click(await within(await waitForRow(CLOUD)).findByRole('button', { name: 'İndir' }))
    await waitFor(() => expect(clicks).toHaveLength(1))
    expect(api.getRecordingUrl).toHaveBeenCalledWith(expect.any(String), { download: true })
    expect(clicks[0].href).toContain('?dl=1')
    expect(clicks[0].hasAttribute('download')).toBe(true)
  })
  it('local copy downloads the blob', async () => {
    const { api } = await setup({ local: [LOCAL], remote: [await info(LOCAL)] })
    const clicks: HTMLAnchorElement[] = []
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { clicks.push(this) })
    fireEvent.click(await within(await waitForRow(LOCAL)).findByRole('button', { name: 'İndir' }))
    await waitFor(() => expect(clicks[0]?.href).toBe('blob:local'))
    expect(api.getRecordingUrl).not.toHaveBeenCalled()
  })
})
async function waitForRow(file: string) {
  await waitFor(() => expect(document.querySelector(`[data-file="${file}"]`)).not.toBeNull())
  return rowOf(file)
}

describe('Paylaş', () => {
  let writeText: ReturnType<typeof vi.fn>
  beforeEach(() => {
    writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
  })
  it('is unavailable for local-only rows', async () => {
    await setup({ local: [LOCAL] })
    const row = await waitForRow(LOCAL)
    const btn = within(row).getByRole('button', { name: 'Paylaş' })
    expect(btn).toBeDisabled()
    expect(btn).toHaveAttribute('title', 'Önce buluta yüklenmeli')
  })
  it('copies the link and shows the toast; then unshares', async () => {
    const { api } = await setup({ remote: [await info(CLOUD)] })
    const row = await waitForRow(CLOUD)
    fireEvent.click(within(row).getByRole('button', { name: 'Paylaş' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('https://srv.test/r/TOKEN'))
    expect(await within(row).findByText('Bağlantı kopyalandı')).toBeInTheDocument()
    fireEvent.click(await within(row).findByRole('button', { name: 'Paylaşımı kaldır' }))
    await waitFor(() => expect(api.unshareRecording).toHaveBeenCalled())
    await waitFor(() => expect(within(row).queryByRole('button', { name: 'Paylaşımı kaldır' })).toBeNull())
  })
  it('shows "Paylaşımı kaldır" for an already shared recording', async () => {
    await setup({ remote: [await info(CLOUD, { shared: true })] })
    const row = await waitForRow(CLOUD)
    expect(within(row).getByRole('button', { name: 'Paylaşımı kaldır' })).toBeInTheDocument()
  })
  it('falls back to a selectable field when the clipboard refuses', async () => {
    writeText.mockRejectedValue(new Error('denied'))
    await setup({ remote: [await info(CLOUD)] })
    const row = await waitForRow(CLOUD)
    fireEvent.click(within(row).getByRole('button', { name: 'Paylaş' }))
    const input = await within(row).findByDisplayValue('https://srv.test/r/TOKEN')
    expect(input).toHaveAttribute('readonly')
  })
})

describe('Sil', () => {
  const confirmDelete = async (row: HTMLElement) => {
    fireEvent.click(within(row).getByRole('button', { name: 'Sil' }))
    return within(row).getByRole('group', { name: 'Silme onayı' })
  }
  it('cloud-only: asks the cloud question, queues + sends the server delete, row disappears', async () => {
    const { prepareDelete, send } = await setup({ remote: [await info(CLOUD)] })
    const group = await confirmDelete(await waitForRow(CLOUD))
    expect(group).toHaveTextContent('Bu kayıt bu bilgisayardan ve buluttan silinsin mi?')
    fireEvent.click(within(group).getByRole('button', { name: 'Sil' }))
    await waitFor(() => expect(document.querySelector(`[data-file="${CLOUD}"]`)).toBeNull())
    expect(prepareDelete).toHaveBeenCalledWith(song, CLOUD)
    expect(send).toHaveBeenCalled()
  })
  it('cloud-only with the delete not queued: error inline, row stays', async () => {
    const { prepareDelete } = await setup({ remote: [await info(CLOUD)] })
    prepareDelete.mockRejectedValue(new Error('x'))
    const group = await confirmDelete(await waitForRow(CLOUD))
    fireEvent.click(within(group).getByRole('button', { name: 'Sil' }))
    expect(await screen.findByText('Silinemedi, tekrar dene.')).toBeInTheDocument()
    expect(document.querySelector(`[data-file="${CLOUD}"]`)).not.toBeNull()
  })
  it('both: deletes the local file and sends the server delete', async () => {
    const { root, send } = await setup({ local: [BOTH], remote: [await info(BOTH)] })
    const group = await confirmDelete(await waitForRow(BOTH))
    expect(group).toHaveTextContent('buluttan')
    fireEvent.click(within(group).getByRole('button', { name: 'Sil' }))
    await waitFor(() => expect(document.querySelector(`[data-file="${BOTH}"]`)).toBeNull())
    expect(await (await songDir(root, song)).readFile(BOTH)).toBeNull()
    expect(send).toHaveBeenCalled()
  })
  it('local-only row on a connected computer keeps the plain question', async () => {
    await setup({ local: [LOCAL], remote: [] })
    await screen.findByText('Yalnız bu bilgisayarda')
    const group = await confirmDelete(rowOf(LOCAL))
    expect(group).toHaveTextContent('Bu kayıt silinsin mi?')
  })
})
