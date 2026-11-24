import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getLightMode } from '../light/lightPrefs'
import { createSong, emptyLibrary, serializeLibrary, updateSong } from '../domain/library'
import type { Song } from '../domain/types'
import { createMemoryDir } from '../storage/memoryDir'
import { songDir } from '../storage/repo'
import SongDetail from './SongDetail'

const urlApi = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL }
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Object.assign(URL, urlApi)
  localStorage.clear()
})

const openDrawer = () => fireEvent.click(screen.getByRole('button', { name: 'Şarkı ayarları' }))

const base = createSong({ title: 'Wonderwall', artist: 'Oasis', status: 'learning', bpm: 87, countInBeats: 4 }, new Date(), 's1')

function setup(opts: { song?: Song; fail?: boolean } = {}) {
  const root = createMemoryDir()
  const patches: Partial<Song>[] = []
  const deleted: string[] = []
  const onBack = vi.fn()
  const patchSong = vi.fn(async (_id: string, p: Partial<Song>) => {
    if (opts.fail) throw new Error('disk')
    patches.push(p)
  })
  const deleteSong = vi.fn(async (id: string) => {
    deleted.push(id)
  })
  function Harness() {
    const [song, setSong] = useState(opts.song ?? base)
    return (
      <SongDetail
        song={song}
        root={root}
        onBack={onBack}
       
        patchSong={async (id, p) => {
          await patchSong(id, p)
          setSong((s) => ({ ...s, ...p }))
        }}
        deleteSong={deleteSong}
      />
    )
  }
  render(<Harness />)
  return { root, patches, deleted, onBack, patchSong, deleteSong }
}

describe('SongDetail', () => {
  it('the settings gear is disabled while the recorder is busy', () => {
    render(
      <SongDetail song={base} root={createMemoryDir()} onBack={() => {}} patchSong={async () => {}} deleteSong={async () => {}} busy />,
    )
    expect(screen.getByRole('button', { name: 'Şarkı ayarları' })).toBeDisabled()
  })

  it('status change persists', async () => {
    const { patches } = setup()
    openDrawer()
    const group = screen.getByRole('group', { name: 'Durum' })
    expect(within(group).getByRole('button', { name: 'Çalıştığım' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(group).getByRole('button', { name: 'Bildiğim' }))
    await waitFor(() => expect(patches).toContainEqual({ status: 'known' }))
    expect(within(group).getByRole('button', { name: 'Bildiğim' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('invalid tempo shows message and is not saved; valid saves', async () => {
    const { patches } = setup()
    openDrawer()
    const bpm = screen.getByLabelText('Tempo (BPM)')
    fireEvent.change(bpm, { target: { value: '5' } })
    fireEvent.blur(bpm)
    expect(await screen.findByText('BPM 30 ile 300 arasında tam sayı olmalı.')).toBeInTheDocument()
    expect(patches).toEqual([])
    fireEvent.change(bpm, { target: { value: '120' } })
    fireEvent.blur(bpm)
    await waitFor(() => expect(patches).toContainEqual({ bpm: 120 }))
  })

  it('invalid count-in is rejected', async () => {
    const { patches } = setup()
    openDrawer()
    const c = screen.getByLabelText('Sayım (vuruş)')
    fireEvent.change(c, { target: { value: '99' } })
    fireEvent.blur(c)
    expect(await screen.findByText('Sayma vuruşu 1 ile 16 arasında tam sayı olmalı.')).toBeInTheDocument()
    expect(patches).toEqual([])
  })

  it('shows save error when patch fails', async () => {
    setup({ fail: true })
    openDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Bildiğim' }))
    expect(await screen.findByText('Kaydedilemedi, tekrar dene.')).toBeInTheDocument()
  })

  it('importing a file sets song.track with defaults, then start point and removal', async () => {
    const { patches, root } = setup()
    openDrawer()
    const file = new File(['abc'], 'backing.MP3', { type: 'audio/mpeg' })
    fireEvent.change(screen.getByLabelText('Parça seç'), { target: { files: [file] } })
    await waitFor(() => expect(patches).toContainEqual({ track: { fileName: 'track.mp3', startSec: 0, volume: 0.7 } }))
    expect(await screen.findByText('track.mp3', { selector: '.track-name' })).toBeInTheDocument()

    const start = screen.getByLabelText('Başlangıç noktası')
    expect(start).toHaveValue('0:00')
    fireEvent.change(start, { target: { value: 'abc' } })
    fireEvent.blur(start)
    expect(await screen.findByText('Geçersiz süre')).toBeInTheDocument()
    expect(patches).toHaveLength(1)
    fireEvent.change(start, { target: { value: '0:12' } })
    fireEvent.blur(start)
    await waitFor(() => expect(patches.at(-1)).toEqual({ track: { fileName: 'track.mp3', startSec: 12, volume: 0.7 } }))
    expect(screen.queryByText('Geçersiz süre')).toBeNull()

    const slider = screen.getByLabelText('Ses seviyesi')
    const before = patches.length
    fireEvent.change(slider, { target: { value: '30' } })
    fireEvent.change(slider, { target: { value: '50' } })
    expect(patches).toHaveLength(before)
    fireEvent.keyUp(slider)
    await waitFor(() => expect(patches.at(-1)).toEqual({ track: { fileName: 'track.mp3', startSec: 12, volume: 0.5 } }))

    fireEvent.click(screen.getByRole('button', { name: 'Kaldır' }))
    await waitFor(() => expect(patches.at(-1)).toEqual({ track: undefined }))
    const dir = await songDir(root, base)
    expect((await dir.list()).map((e) => e.name)).not.toContain('track.mp3')
    const lib = { ...emptyLibrary(), songs: [{ ...base, track: { fileName: 'track.mp3', startSec: 12, volume: 0.5 } }] }
    expect(serializeLibrary(updateSong(lib, 's1', patches.at(-1)!, new Date()))).not.toContain('"track"')
    expect(await screen.findByLabelText('Parça seç')).toBeInTheDocument()
  })

  it('start point error does not leak into a re-imported track', async () => {
    setup()
    openDrawer()
    const file = new File(['abc'], 'a.mp3')
    fireEvent.change(screen.getByLabelText('Parça seç'), { target: { files: [file] } })
    const start = await screen.findByLabelText('Başlangıç noktası')
    fireEvent.change(start, { target: { value: 'abc' } })
    fireEvent.blur(start)
    expect(await screen.findByText('Geçersiz süre')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Kaldır' }))
    fireEvent.change(await screen.findByLabelText('Parça seç'), { target: { files: [file] } })
    expect(await screen.findByLabelText('Başlangıç noktası')).toHaveValue('0:00')
    expect(screen.queryByText('Geçersiz süre')).toBeNull()
  })

  it('lists recordings newest first with Turkish dates and kinds', async () => {
    const root = createMemoryDir()
    const dir = await songDir(root, base)
    await dir.writeFile('2026-11-23_09-05-00_ses.webm', 'a')
    await dir.writeFile('2026-11-24_21-30-00_video.webm', 'b')
    render(
      <SongDetail song={base} root={root} onBack={() => {}} patchSong={async () => {}} deleteSong={async () => {}} />,
    )
    const rows = await screen.findAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('24 Kas 2026 21:30')
    expect(rows[0]).toHaveTextContent('video')
    expect(rows[1]).toHaveTextContent('23 Kas 2026 09:05')
    expect(rows[1]).toHaveTextContent('ses')
  })

  it('shows empty message', async () => {
    setup()
    expect(await screen.findByText('Henüz kayıt yok.')).toBeInTheDocument()
  })

  it('delete asks for confirmation', async () => {
    const { deleted, onBack } = setup()
    openDrawer()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    fireEvent.click(screen.getByRole('button', { name: 'Sil' }))
    expect(confirm).toHaveBeenCalledWith('Şarkı listeden kaldırılsın mı? Kayıt dosyaların klasörde kalır.')
    expect(deleted).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Sil' }))
    await waitFor(() => expect(deleted).toEqual(['s1']))
    await waitFor(() => expect(onBack).toHaveBeenCalled())
    confirm.mockRestore()
  })

  it('edit opens SongForm and saves', async () => {
    const { patches } = setup()
    openDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Düzenle' }))
    const dialog = screen.getByRole('dialog', { name: 'Şarkıyı düzenle' })
    expect(within(dialog).getByLabelText('Şarkı adı')).toHaveFocus()
    fireEvent.change(screen.getByLabelText('Şarkı adı'), { target: { value: 'Champagne Supernova' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(patches[0]).toMatchObject({ title: 'Champagne Supernova', artist: 'Oasis' }))
    expect(await screen.findByRole('heading', { name: /Champagne Supernova/ })).toBeInTheDocument()
  })

  it('renders the recorder slot', async () => {
    const root = createMemoryDir()
    render(
      <SongDetail song={base} root={root} onBack={() => {}} patchSong={async () => {}} deleteSong={async () => {}} recorder={<div>REC</div>} />,
    )
    expect(await screen.findByText('REC')).toBeInTheDocument()
  })

  it('editing keeps the recorder mounted so a take is not stopped', async () => {
    let mounts = 0
    function Probe() {
      useEffect(() => {
        mounts++
        return () => {
          mounts--
        }
      }, [])
      return <div>REC</div>
    }
    const root = createMemoryDir()
    render(<SongDetail song={base} root={root} onBack={() => {}} patchSong={async () => {}} deleteSong={async () => {}} recorder={<Probe />} />)
    expect(mounts).toBe(1)
    openDrawer()
    expect(mounts).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Düzenle' }))
    expect(screen.getByText('Şarkıyı düzenle')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByLabelText('Şarkı adı')).toBeInTheDocument()
    expect(mounts).toBe(1)
    expect(screen.getByText('REC')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Vazgeç' }))
    expect(mounts).toBe(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mounts).toBe(1)
    expect(screen.getByText('REC')).toBeVisible()
  })
})

describe('SongDetail layout and settings drawer', () => {
  it('header shows title, meta line, big tempo; ‹ goes back', async () => {
    const { onBack } = setup()
    expect(screen.getByRole('heading', { level: 1, name: 'Wonderwall' })).toBeInTheDocument()
    expect(screen.getByText('OASIS · ÇALIŞTIĞIM')).toBeInTheDocument()
    expect(screen.getByText('87')).toBeInTheDocument()
    expect(screen.getByText('BPM · 4 VURUŞ')).toBeInTheDocument()
    expect(screen.queryByText(/PARÇA:/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Geri' }))
    expect(onBack).toHaveBeenCalled()
    await screen.findByText('Henüz kayıt yok.')
  })

  it('⚙ opens the drawer with focus on its first control; Esc closes and focus returns to ⚙', async () => {
    setup()
    const gear = screen.getByRole('button', { name: 'Şarkı ayarları' })
    expect(screen.queryByRole('dialog')).toBeNull()
    gear.focus()
    fireEvent.click(gear)
    const dialog = screen.getByRole('dialog', { name: 'Şarkı ayarları' })
    expect(within(dialog).getByRole('button', { name: 'Çalıştığım' })).toHaveFocus()
    const labels = within(dialog).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(labels).toEqual(['Durum', 'Tempo', 'Sayım', 'Parça', 'Cihazlar', 'Işık'])
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(gear).toHaveFocus()
    await screen.findByText('Henüz kayıt yok.')
  })

  it('backdrop click closes the drawer', async () => {
    const { container } = render(
      <SongDetail song={base} root={createMemoryDir()} onBack={() => {}} patchSong={async () => {}} deleteSong={async () => {}} />,
    )
    openDrawer()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    fireEvent.click(container.querySelector('.drawer-backdrop')!)
    expect(screen.queryByRole('dialog')).toBeNull()
    await screen.findByText('Henüz kayıt yok.')
  })

  it('device section is a portal target that exists while the drawer is closed', async () => {
    render(
      <SongDetail song={base} root={createMemoryDir()} onBack={() => {}} patchSong={async () => {}} deleteSong={async () => {}} drawerSlot={<span>DEV</span>} />,
    )
    expect(document.getElementById('device-settings')).toHaveTextContent('DEV')
    await screen.findByText('Henüz kayıt yok.')
  })

  it('light segment changes getLightMode()', async () => {
    setup()
    openDrawer()
    const group = screen.getByRole('group', { name: 'Işık' })
    expect(within(group).getByRole('button', { name: 'A · Alttan parıltı' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(group).getByRole('button', { name: 'C · Tüm ekran' }))
    expect(getLightMode()).toBe('c')
    expect(within(group).getByRole('button', { name: 'C · Tüm ekran' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(within(group).getByRole('button', { name: 'Kapalı' }))
    expect(getLightMode()).toBe('off')
    await screen.findByText('Henüz kayıt yok.')
  })

  it('file picker is a "Parça seç" button, no browser "Choose File" control', async () => {
    setup()
    openDrawer()
    expect(screen.getByRole('button', { name: 'Parça seç' })).toBeInTheDocument()
    expect(screen.getByLabelText('Parça seç')).not.toBeVisible()
    expect(screen.queryByText(/Choose File/i)).toBeNull()
    fireEvent.change(screen.getByLabelText('Parça seç'), { target: { files: [new File(['x'], 'a.mp3')] } })
    expect(await screen.findByRole('button', { name: 'Değiştir' })).toBeInTheDocument()
    expect(screen.getByText('track.mp3', { selector: '.song-head-file' })).toBeInTheDocument()
  })

  it('"Buradan başla" saves the player position rounded to 0.1 s and shows it in the m:ss field', async () => {
    let current = 0
    vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockImplementation(() => 100)
    vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'get').mockImplementation(() => current)
    const created: string[] = []
    const revoked: string[] = []
    Object.assign(URL, {
      createObjectURL: vi.fn(() => {
        created.push(`blob:${created.length}`)
        return created.at(-1)!
      }),
      revokeObjectURL: vi.fn((u: string) => revoked.push(u)),
    })
    const { patches } = setup()
    openDrawer()
    fireEvent.change(screen.getByLabelText('Parça seç'), { target: { files: [new File(['abc'], 'b.mp3')] } })
    const startHere = await screen.findByRole('button', { name: 'Buradan başla' })
    const audio = document.querySelector('.track-panel audio') as HTMLAudioElement
    expect(audio).toHaveAttribute('src', 'blob:0')
    current = 12.34
    fireEvent.timeUpdate(audio)
    fireEvent.click(startHere)
    await waitFor(() => expect(patches.at(-1)).toEqual({ track: { fileName: 'track.mp3', startSec: 12.3, volume: 0.7 } }))
    const start = screen.getByLabelText('Başlangıç noktası')
    expect(start).toHaveValue('0:12.3')
    // Blurring the untouched field must not round the saved value away.
    const n = patches.length
    fireEvent.blur(start)
    expect(patches).toHaveLength(n)
    fireEvent.click(screen.getByRole('button', { name: 'Kaldır' }))
    await waitFor(() => expect(revoked).toContain('blob:0'))
  })

  it('closing the drawer mid-edit keeps the typed form state', async () => {
    setup()
    openDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Düzenle' }))
    fireEvent.change(screen.getByLabelText('Şarkı adı'), { target: { value: 'Yarım' } })
    fireEvent.keyDown(document, { key: 'Escape' })
    openDrawer()
    expect(screen.getByLabelText('Şarkı adı')).toHaveValue('Yarım')
    fireEvent.click(screen.getByRole('button', { name: 'Vazgeç' }))
    expect(screen.getByRole('button', { name: 'Düzenle' })).toHaveFocus()
    await screen.findByText('Henüz kayıt yok.')
  })
  it('the track preview plays at the track volume', async () => {
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:v'), revokeObjectURL: vi.fn() })
    setup()
    openDrawer()
    fireEvent.change(screen.getByLabelText('Parça seç'), { target: { files: [new File(['abc'], 'b.mp3')] } })
    await screen.findByRole('button', { name: 'Buradan başla' })
    const audio = document.querySelector('.track-panel audio') as HTMLAudioElement
    expect(audio.volume).toBeCloseTo(0.7)
  })

  it('a recorder render function learns whether the drawer is open', () => {
    const seen: boolean[] = []
    render(
      <SongDetail
        song={base}
        root={createMemoryDir()}
        onBack={() => {}}
        patchSong={async () => {}}
        deleteSong={async () => {}}
        recorder={(open) => {
          seen.push(open)
          return <div>REC</div>
        }}
      />,
    )
    expect(seen.at(-1)).toBe(false)
    openDrawer()
    expect(seen.at(-1)).toBe(true)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(seen.at(-1)).toBe(false)
  })
})
