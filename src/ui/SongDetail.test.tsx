import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSong, emptyLibrary, serializeLibrary, updateSong } from '../domain/library'
import type { Song } from '../domain/types'
import { createMemoryDir } from '../storage/memoryDir'
import { songDir } from '../storage/repo'
import SongDetail from './SongDetail'

afterEach(cleanup)

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
  it('status change persists', async () => {
    const { patches } = setup()
    fireEvent.change(screen.getByLabelText('Durum'), { target: { value: 'known' } })
    await waitFor(() => expect(patches).toContainEqual({ status: 'known' }))
  })

  it('invalid tempo shows message and is not saved; valid saves', async () => {
    const { patches } = setup()
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
    const c = screen.getByLabelText('Sayım (vuruş)')
    fireEvent.change(c, { target: { value: '99' } })
    fireEvent.blur(c)
    expect(await screen.findByText('Sayma vuruşu 1 ile 16 arasında tam sayı olmalı.')).toBeInTheDocument()
    expect(patches).toEqual([])
  })

  it('shows save error when patch fails', async () => {
    setup({ fail: true })
    fireEvent.change(screen.getByLabelText('Durum'), { target: { value: 'known' } })
    expect(await screen.findByText('Kaydedilemedi, tekrar dene.')).toBeInTheDocument()
  })

  it('importing a file sets song.track with defaults, then start point and removal', async () => {
    const { patches, root } = setup()
    const file = new File(['abc'], 'backing.MP3', { type: 'audio/mpeg' })
    fireEvent.change(screen.getByLabelText('Parça ekle'), { target: { files: [file] } })
    await waitFor(() => expect(patches).toContainEqual({ track: { fileName: 'track.mp3', startSec: 0, volume: 0.7 } }))
    expect(await screen.findByText('track.mp3')).toBeInTheDocument()

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
    expect(await screen.findByLabelText('Parça ekle')).toBeInTheDocument()
  })

  it('start point error does not leak into a re-imported track', async () => {
    setup()
    const file = new File(['abc'], 'a.mp3')
    fireEvent.change(screen.getByLabelText('Parça ekle'), { target: { files: [file] } })
    const start = await screen.findByLabelText('Başlangıç noktası')
    fireEvent.change(start, { target: { value: 'abc' } })
    fireEvent.blur(start)
    expect(await screen.findByText('Geçersiz süre')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Kaldır' }))
    fireEvent.change(await screen.findByLabelText('Parça ekle'), { target: { files: [file] } })
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
    fireEvent.click(screen.getByRole('button', { name: 'Düzenle' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Düzenle' }))
    expect(screen.getByText('Şarkıyı düzenle')).toBeInTheDocument()
    expect(mounts).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'Vazgeç' }))
    expect(mounts).toBe(1)
    expect(screen.getByText('REC')).toBeVisible()
  })
})
