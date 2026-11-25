import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startTake } from '../audio/engine'
import { createSong } from '../domain/library'
import type { Song } from '../domain/types'
import { createMemoryDir } from '../storage/memoryDir'
import Recorder from './Recorder'
import SongDetail from './SongDetail'

vi.mock('../audio/engine', () => ({ startTake: vi.fn(), decodeTrack: vi.fn() }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const base = createSong({ title: 'Wonderwall', artist: 'Oasis', status: 'learning', bpm: 87, countInBeats: 4 }, new Date(), 's1')
const SHEET = '[Verse]\nEm7   G   Dsus4   A7sus4\nToday is gonna be the day'

function setup(opts: { song?: Song; fail?: boolean } = {}) {
  const patches: Partial<Song>[] = []
  function Harness() {
    const [song, setSong] = useState(opts.song ?? base)
    return (
      <SongDetail
        song={song}
        root={createMemoryDir()}
        onBack={() => {}}
        deleteSong={async () => {}}
        recorder={<div data-testid="rec">stage</div>}
        patchSong={async (_id, p) => {
          if (opts.fail) throw new Error('disk')
          patches.push(p)
          setSong((s) => ({ ...s, ...p }))
        }}
      />
    )
  }
  const view = render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: 'Şarkı ayarları' }))
  return { patches, view }
}
const textarea = () => screen.getByRole('textbox', { name: 'Akorlar' }) as HTMLTextAreaElement

describe('Akorlar drawer section', () => {
  it('comes right after Parça and has a monospace textarea with the Turkish placeholder', () => {
    setup()
    const dialog = screen.getByRole('dialog', { name: 'Şarkı ayarları' })
    const labels = within(dialog).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)
    expect(labels[labels.indexOf('Parça') + 1]).toBe('Akorlar')
    expect(textarea()).toHaveAttribute('id', 'chords-input')
    expect(textarea()).toHaveAttribute('placeholder', 'Akorları buraya yapıştır…')
  })

  it('typing chords and leaving the field saves them; blur without a change does not', async () => {
    const { patches } = setup()
    fireEvent.blur(textarea())
    expect(patches).toEqual([])
    fireEvent.change(textarea(), { target: { value: SHEET } })
    fireEvent.blur(textarea())
    await waitFor(() => expect(patches).toEqual([{ chords: SHEET }]))
    fireEvent.blur(textarea())
    expect(patches).toHaveLength(1)
  })

  it('clearing the field removes the chords', async () => {
    const { patches } = setup({ song: { ...base, chords: SHEET } })
    fireEvent.change(textarea(), { target: { value: '' } })
    fireEvent.blur(textarea())
    await waitFor(() => expect(patches).toEqual([{ chords: undefined }]))
  })

  it('a failed save shows "Kaydedilemedi, tekrar dene."', async () => {
    setup({ fail: true })
    fireEvent.change(textarea(), { target: { value: 'Am G' } })
    fireEvent.blur(textarea())
    expect(await screen.findByRole('alert')).toHaveTextContent('Kaydedilemedi, tekrar dene.')
  })

  it('"Akorları ara" opens the exact Google search in a new tab', () => {
    setup({ song: { ...base, title: 'Kır Çiçeği', artist: 'Barış & Co' } })
    const link = screen.getByRole('link', { name: 'Akorları ara ↗' })
    expect(link).toHaveAttribute('href', `https://www.google.com/search?q=${encodeURIComponent('Kır Çiçeği Barış & Co chords')}`)
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener')
  })

  it('shows a small preview only when there is text', () => {
    setup()
    const section = textarea().closest('section')!
    expect(section.querySelector('.chord-sheet')).toBeNull()
    fireEvent.change(textarea(), { target: { value: SHEET } })
    expect(section.querySelector('.chord-sheet.sm')).not.toBeNull()
  })
})

describe('chords next to the stage', () => {
  it('a song with chords renders the chord sheet (lg) beside the recorder slot', () => {
    setup({ song: { ...base, chords: SHEET } })
    const aside = screen.getByRole('complementary', { name: 'Akorlar' })
    expect(aside.querySelector('.chord-sheet.lg')).not.toBeNull()
    expect(within(aside).getByText('Dsus4')).toHaveClass('chord')
    expect(aside.parentElement).toBe(screen.getByTestId('rec').closest('.recorder-slot')!.parentElement)
    expect(aside.parentElement).toHaveClass('has-chords')
  })

  it('a song without chords has no chords panel', () => {
    const { view } = setup()
    expect(screen.queryByRole('complementary', { name: 'Akorlar' })).toBeNull()
    expect(view.container.querySelector('.has-chords')).toBeNull()
  })

  it('Space typed inside the chords textarea does not start a take', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn(async () => ({ getTracks: () => [], getAudioTracks: () => [], getVideoTracks: () => [] })), enumerateDevices: async () => [] },
    })
    const root = createMemoryDir()
    render(
      <SongDetail
        song={base}
        root={root}
        onBack={() => {}}
        patchSong={async () => {}}
        deleteSong={async () => {}}
        recorder={<Recorder song={base} root={root} latencyMs={null} onSaved={() => {}} />}
      />,
    )
    vi.mocked(startTake).mockImplementation(() => ({ stop: vi.fn(), cancel: vi.fn(), done: new Promise<string | null>(() => {}) }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Kaydet' })).toBeEnabled())
    fireEvent.click(screen.getByRole('button', { name: 'Şarkı ayarları' }))
    expect(fireEvent.keyDown(textarea(), { key: ' ' })).toBe(true)
    await act(async () => {})
    expect(vi.mocked(startTake)).not.toHaveBeenCalled()
    // Control: the same Space on the page body does start a take.
    fireEvent.keyDown(document.body, { key: ' ' })
    await waitFor(() => expect(vi.mocked(startTake)).toHaveBeenCalledTimes(1))
  })
})
