import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startTake, type TakeOptions } from '../audio/engine'
import { createSong } from '../domain/library'
import { createMemoryDir } from '../storage/memoryDir'
import Recorder from './Recorder'
import SongDetail from './SongDetail'
import { setPreviewHidden } from './usePreviewHidden'

vi.mock('../audio/engine', () => ({ startTake: vi.fn(), decodeTrack: vi.fn() }))
const startTakeMock = vi.mocked(startTake)

const song = createSong({ title: 'Blackbird', artist: 'The Beatles', status: 'known', bpm: 94, countInBeats: 4 }, new Date(), 's2')
const stopVideo = vi.fn()
const videoTrack = { kind: 'video', stop: stopVideo, label: 'HD Webcam' }
const audioTrack = { kind: 'audio', stop: vi.fn(), label: 'Mic' }
const stream = {
  getTracks: () => [audioTrack, videoTrack],
  getAudioTracks: () => [audioTrack],
  getVideoTracks: () => [videoTrack],
}

beforeEach(() => {
  setPreviewHidden(false)
  localStorage.clear()
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn(async () => stream), enumerateDevices: async () => [] },
  })
  startTakeMock.mockImplementation(() => ({ stop: vi.fn(), cancel: vi.fn(), done: new Promise<string | null>(() => {}) }))
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const renderRec = (extra?: Partial<React.ComponentProps<typeof Recorder>>) =>
  render(<Recorder song={song} root={createMemoryDir()} latencyMs={null} onSaved={() => {}} {...extra} />)

async function toVideo() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Kaydet' })).toBeEnabled())
  fireEvent.click(screen.getByRole('button', { name: 'Video' }))
  await waitFor(() => expect(document.querySelector('video.preview')).not.toBeNull())
  stopVideo.mockClear() // switching mode released the audio-only stream
}

describe('preview toggle', () => {
  it('is only shown in video mode', async () => {
    renderRec()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Kaydet' })).toBeEnabled())
    expect(screen.queryByRole('button', { name: /Önizlemeyi/ })).toBeNull()
    await toVideo()
    expect(screen.getByRole('button', { name: 'Önizlemeyi gizle' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('hides the preview but keeps the video mounted and the camera live; persisted', async () => {
    renderRec()
    await toVideo()
    fireEvent.click(screen.getByRole('button', { name: 'Önizlemeyi gizle' }))
    const toggle = screen.getByRole('button', { name: 'Önizlemeyi göster' })
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    const video = document.querySelector('video.preview')!
    expect(video).toHaveClass('preview-off')
    expect(document.querySelector('.rec-stage')).toHaveClass('rec-stage-hidden')
    expect(screen.getByText('Kamera kayıtta · önizleme gizli')).toBeInTheDocument()
    expect(stopVideo).not.toHaveBeenCalled()
    expect(localStorage.getItem('mm.previewHidden')).toBe('1')
    fireEvent.click(toggle)
    expect(document.querySelector('video.preview')).toBe(video)
    expect(video).not.toHaveClass('preview-off')
    expect(localStorage.getItem('mm.previewHidden')).toBe('0')
  })

  it('is remembered on the device, and does not collapse the stage in ses mode', async () => {
    setPreviewHidden(true)
    renderRec()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Kaydet' })).toBeEnabled())
    expect(document.querySelector('.rec-stage')).not.toHaveClass('rec-stage-hidden')
    await toVideo()
    expect(screen.getByRole('button', { name: 'Önizlemeyi göster' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('a take started while hidden still gets the camera track', async () => {
    renderRec()
    await toVideo()
    fireEvent.click(screen.getByRole('button', { name: 'Önizlemeyi gizle' }))
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(startTakeMock).toHaveBeenCalledTimes(1))
    const opts = startTakeMock.mock.calls[0][0] as TakeOptions
    expect(opts.kind).toBe('video')
    expect(opts.input.getVideoTracks()).toHaveLength(1)
    expect(stopVideo).not.toHaveBeenCalled()
  })

  it('Space on the toggle toggles it and does not start a take', async () => {
    renderRec()
    await toVideo()
    const toggle = screen.getByRole('button', { name: 'Önizlemeyi gizle' })
    expect(fireEvent.keyDown(toggle, { key: ' ' })).toBe(true) // left to the button
    await act(async () => {})
    expect(startTakeMock).not.toHaveBeenCalled()
    fireEvent.click(toggle) // what the browser does on Space keyup
    expect(screen.getByRole('button', { name: 'Önizlemeyi göster' })).toBeInTheDocument()
  })

  it('with focus on the toggle, Space stops a running take and Escape cancels the count-in', async () => {
    const stop = vi.fn()
    const cancel = vi.fn()
    startTakeMock.mockImplementation(() => ({ stop, cancel, done: new Promise<string | null>(() => {}) }))
    renderRec()
    await toVideo()
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(startTakeMock).toHaveBeenCalledTimes(1))
    const toggle = screen.getByRole('button', { name: 'Önizlemeyi gizle' })
    const opts = startTakeMock.mock.calls[0][0] as TakeOptions
    act(() => opts.onState('countingIn'))
    fireEvent.keyDown(toggle, { key: 'Escape' })
    expect(cancel).toHaveBeenCalledTimes(1)
    act(() => opts.onState('recording'))
    expect(fireEvent.keyDown(toggle, { key: ' ' })).toBe(false) // default prevented: no native click
    expect(stop).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Önizlemeyi gizle' })).toHaveAttribute('aria-pressed', 'false')
  })

  it('chords panel takes the stage when the preview is hidden', async () => {
    const withChords = { ...song, chords: 'Am G' }
    render(
      <SongDetail
        song={withChords}
        root={createMemoryDir()}
        onBack={() => {}}
        patchSong={async () => {}}
        deleteSong={async () => {}}
        recorder={<Recorder song={withChords} root={createMemoryDir()} latencyMs={null} onSaved={() => {}} />}
      />,
    )
    await toVideo()
    fireEvent.click(screen.getByRole('button', { name: 'Önizlemeyi gizle' }))
    // CSS (:has) does the layout; the contract is stage-hidden + panel in the same wrapper.
    const area = document.querySelector('.stage-area.has-chords')!
    expect(area.querySelector('.rec-stage-hidden')).not.toBeNull()
    expect(area.querySelector('.chords-panel')).not.toBeNull()
  })
})
