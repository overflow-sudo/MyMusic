import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSong, emptyLibrary } from '../domain/library'
import type { Library, SongStatus } from '../domain/types'
import SongList, { type SongInput } from './SongList'

afterEach(cleanup)

const mk = (title: string, artist: string, status: SongStatus, n: number) =>
  createSong({ title, artist, status, bpm: 100, countInBeats: 4 }, new Date(), `id${n}`)

function lib(...songs: ReturnType<typeof mk>[]): Library {
  return { ...emptyLibrary(), songs }
}

const base = lib(
  mk('Wonderwall', 'Oasis', 'learning', 1),
  mk('Işık', 'Biri', 'learning', 2),
  mk('Hotel California', 'Eagles', 'known', 3),
)

function Harness({ initial = base, onOpen = () => {}, counts = {} }: { initial?: Library; onOpen?: (id: string) => void; counts?: Record<string, number> }) {
  const [library, setLibrary] = useState(initial)
  const onAdd = async (input: SongInput) => {
    setLibrary((l) => ({ ...l, songs: [...l.songs, createSong(input, new Date(), 'new1')] }))
  }
  return <SongList library={library} onOpen={onOpen} onAdd={onAdd} recordingCounts={counts} />
}

describe('SongList', () => {
  it('shows tab counts, default tab Çalıştığım', () => {
    render(<Harness />)
    expect(screen.getByRole('tab', { name: 'Bildiğim (1)' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Çalıştığım (2)' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText(/Wonderwall/)).toBeInTheDocument()
    expect(screen.queryByText(/Hotel California/)).toBeNull()
    fireEvent.click(screen.getByRole('tab', { name: 'Bildiğim (1)' }))
    expect(screen.getByText(/Hotel California/)).toBeInTheDocument()
  })

  it('searches case-insensitively over title and artist', () => {
    render(<Harness />)
    const box = screen.getByRole('searchbox')
    fireEvent.change(box, { target: { value: 'oas' } })
    expect(screen.getByText(/Wonderwall/)).toBeInTheDocument()
    fireEvent.change(box, { target: { value: 'OASIS' } })
    expect(screen.getByText(/Wonderwall/)).toBeInTheDocument()
    expect(screen.queryByText(/Işık/)).toBeNull()
  })

  it('uses Turkish casing: "ı" matches Işık, "I" matches Işık', () => {
    render(<Harness />)
    const box = screen.getByRole('searchbox')
    fireEvent.change(box, { target: { value: 'ı' } })
    expect(screen.getByText(/Işık/)).toBeInTheDocument()
    fireEvent.change(box, { target: { value: 'I' } })
    expect(screen.getByText(/Işık/)).toBeInTheDocument()
  })

  it('shows recording count or dash, and opens a song', () => {
    const onOpen = vi.fn()
    render(<Harness onOpen={onOpen} counts={{ id1: 3 }} />)
    expect(screen.getByText('3 kayıt')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    fireEvent.click(screen.getByText(/Wonderwall/))
    expect(onOpen).toHaveBeenCalledWith('id1')
  })

  it('shows empty state', () => {
    render(<Harness initial={lib()} />)
    expect(screen.getByText('Henüz şarkı yok. + Şarkı ekle ile başla.')).toBeInTheDocument()
  })

  it('form validates and does not submit invalid input', () => {
    const onAdd = vi.fn()
    render(<SongList library={base} onOpen={() => {}} onAdd={onAdd} recordingCounts={{}} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Şarkı ekle' }))
    fireEvent.change(screen.getByLabelText('Tempo (BPM)'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(screen.getByText('Şarkı adı boş olamaz.')).toBeInTheDocument()
    expect(screen.getByText('BPM 30 ile 300 arasında tam sayı olmalı.')).toBeInTheDocument()
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('submitted song appears in the current tab', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('tab', { name: 'Bildiğim (1)' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Şarkı ekle' }))
    expect(screen.getByLabelText('Durum')).toHaveValue('known')
    expect(screen.getByLabelText('Tempo (BPM)')).toHaveValue('100')
    expect(screen.getByLabelText('Sayım (vuruş)')).toHaveValue('4')
    fireEvent.change(screen.getByLabelText('Şarkı adı'), { target: { value: 'Yeni Şarkı' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(await screen.findByText(/Yeni Şarkı/)).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Bildiğim (2)' })).toBeInTheDocument()
    expect(within(screen.getByRole('tabpanel')).queryByLabelText('Şarkı adı')).toBeNull()
  })

  it('cancel closes the form', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: '+ Şarkı ekle' }))
    fireEvent.click(screen.getByRole('button', { name: 'Vazgeç' }))
    expect(screen.queryByLabelText('Şarkı adı')).toBeNull()
  })

  it('failed save shows a message and keeps the form with its input', async () => {
    const onAdd = vi.fn().mockRejectedValue(new Error('disk'))
    render(<SongList library={base} onOpen={() => {}} onAdd={onAdd} recordingCounts={{}} />)
    fireEvent.click(screen.getByRole('button', { name: '+ Şarkı ekle' }))
    fireEvent.change(screen.getByLabelText('Şarkı adı'), { target: { value: 'Yeni' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(await screen.findByText('Kaydedilemedi, tekrar dene.')).toBeInTheDocument()
    expect(screen.getByLabelText('Şarkı adı')).toHaveValue('Yeni')
    expect(onAdd).toHaveBeenCalledTimes(1)
  })
})
