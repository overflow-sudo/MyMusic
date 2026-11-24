import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeTrack, startTake, type TakeOptions } from '../audio/engine'
import { createSong } from '../domain/library'
import type { Song } from '../domain/types'
import { createMemoryDir } from '../storage/memoryDir'
import { songDir } from '../storage/repo'
import Recorder from './Recorder'
import SongDetail from './SongDetail'

vi.mock('../audio/engine', () => ({ startTake: vi.fn(), decodeTrack: vi.fn() }))

const startTakeMock = vi.mocked(startTake)
const decodeMock = vi.mocked(decodeTrack)

const withTrack = (startSec: number): Song => ({
  ...createSong({ title: 'Wonderwall', artist: 'Oasis', status: 'learning', bpm: 87, countInBeats: 4 }, new Date(), 's1'),
  track: { fileName: 'track.mp3', startSec, volume: 0.7 },
})
const plain = createSong({ title: 'Blackbird', artist: 'The Beatles', status: 'known', bpm: 94, countInBeats: 4 }, new Date(), 's2')

const stopTrack = vi.fn()
const fakeStream = { getTracks: () => [{ stop: stopTrack }], getAudioTracks: () => [], getVideoTracks: () => [] }
let getUserMedia: ReturnType<typeof vi.fn>
let finishTake: (v: string | null) => void
let failTake: (e: Error) => void
const takeStop = vi.fn()
const takeCancel = vi.fn()

beforeEach(() => {
  localStorage.clear()
  getUserMedia = vi.fn(async () => fakeStream)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia,
      enumerateDevices: async () => [
        { kind: 'audioinput', deviceId: 'b1', label: 'Voicemeeter Out B1', groupId: '' },
        { kind: 'audiooutput', deviceId: 'ma', label: 'Speakers (M-Audio M-Track Solo)', groupId: '' },
      ],
    },
  })
  startTakeMock.mockImplementation(() => ({
    stop: takeStop,
    cancel: takeCancel,
    done: new Promise<string | null>((res, rej) => {
      finishTake = res
      failTake = rej
    }),
  }))
})
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderRecorder(song: Song, root = createMemoryDir(), onSaved = vi.fn()) {
  render(<Recorder song={song} root={root} latencyMs={null} onSaved={onSaved} />)
  return { root, onSaved }
}

async function chooseAudio() {
  fireEvent.click(screen.getByRole('button', { name: '🎙 Ses kaydı' }))
  await waitFor(() => expect(screen.getByRole('button', { name: '● Kaydet' })).toBeEnabled())
  await screen.findByRole('option', { name: 'Speakers (M-Audio M-Track Solo)' })
}

const lastOptions = () => startTakeMock.mock.calls.at(-1)![0] as TakeOptions

describe('Recorder', () => {
  it('asks for the mic with raw-audio constraints and the saved device', async () => {
    localStorage.setItem('mm.mic', 'b1')
    renderRecorder(plain)
    await chooseAudio()
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: expect.objectContaining({ echoCancellation: false, noiseSuppression: false, autoGainControl: false, deviceId: { exact: 'b1' } }),
      video: false,
    })
    expect(screen.getByText("Tık kayda girmesin: Voicemeeter'da tarayıcı sesini yalnızca A1'e (kulaklık) gönder, B hattına gönderme.")).toBeInTheDocument()
  })

  it('missing track file: Turkish message, records without track', async () => {
    renderRecorder(withTrack(0))
    await chooseAudio()
    fireEvent.click(screen.getByRole('button', { name: '● Kaydet' }))
    expect(await screen.findByText('Parça dosyası bulunamadı, parçasız kaydediliyor.')).toBeInTheDocument()
    await waitFor(() => expect(startTakeMock).toHaveBeenCalledTimes(1))
    expect(lastOptions().track).toBeUndefined()
    expect(lastOptions().kind).toBe('ses')
    expect(lastOptions().input).toBe(fakeStream)
    expect(lastOptions().outputDeviceId).toBe('ma') // M-Audio suggested when nothing saved
  })

  it('start point past the end: Turkish message, records without track', async () => {
    const song = withTrack(12)
    const root = createMemoryDir()
    await (await songDir(root, song)).writeFile('track.mp3', 'mp3')
    decodeMock.mockResolvedValue({ duration: 10 } as AudioBuffer)
    renderRecorder(song, root)
    await chooseAudio()
    fireEvent.click(screen.getByRole('button', { name: '● Kaydet' }))
    expect(await screen.findByText('Başlangıç noktası parçanın sonundan sonra, parçasız kaydediliyor.')).toBeInTheDocument()
    await waitFor(() => expect(startTakeMock).toHaveBeenCalledTimes(1))
    expect(lastOptions().track).toBeUndefined()
  })

  it('passes the decoded track with start point and volume', async () => {
    const song = withTrack(3)
    const root = createMemoryDir()
    await (await songDir(root, song)).writeFile('track.mp3', 'mp3')
    const buffer = { duration: 100 } as AudioBuffer
    decodeMock.mockResolvedValue(buffer)
    renderRecorder(song, root)
    await chooseAudio()
    fireEvent.click(screen.getByRole('button', { name: '● Kaydet' }))
    await waitFor(() => expect(startTakeMock).toHaveBeenCalledTimes(1))
    expect(lastOptions().track).toEqual({ buffer, startSec: 3, volume: 0.7 })
  })

  it('permission denied shows a Turkish message', async () => {
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    renderRecorder(plain)
    fireEvent.click(screen.getByRole('button', { name: '🎙 Ses kaydı' }))
    expect(await screen.findByText('Mikrofona erişim izni verilmedi.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '● Kaydet' })).toBeDisabled()
  })

  it('missing camera shows a Turkish message', async () => {
    getUserMedia.mockRejectedValue(new DOMException('none', 'NotFoundError'))
    renderRecorder(plain)
    fireEvent.click(screen.getByRole('button', { name: '🎥 Video kaydı' }))
    expect(await screen.findByText('Kamera bulunamadı.')).toBeInTheDocument()
  })

  it('Space on the body starts; while typing in the tempo input it does not', async () => {
    const root = createMemoryDir()
    render(
      <SongDetail
        song={plain}
        root={root}
        onBack={() => {}}
        patchSong={async () => {}}
        deleteSong={async () => {}}
        recorder={<Recorder song={plain} root={root} latencyMs={null} onSaved={() => {}} />}
      />,
    )
    await chooseAudio()
    fireEvent.keyDown(screen.getByLabelText('Tempo (BPM)'), { key: ' ' })
    await act(async () => {})
    expect(startTakeMock).not.toHaveBeenCalled()
    const notPrevented = fireEvent.keyDown(document.body, { key: ' ' })
    expect(notPrevented).toBe(false)
    await waitFor(() => expect(startTakeMock).toHaveBeenCalledTimes(1))
  })

  it('Space again during count-in does nothing, even with the button focused', async () => {
    renderRecorder(plain)
    await chooseAudio()
    fireEvent.keyDown(document.body, { key: ' ' })
    await waitFor(() => expect(startTakeMock).toHaveBeenCalledTimes(1))
    act(() => lastOptions().onState('countingIn'))
    const button = screen.getByRole('button', { name: '■ Durdur' })
    button.focus()
    expect(fireEvent.keyDown(button, { key: ' ' })).toBe(false) // default (button click) suppressed
    expect(takeStop).not.toHaveBeenCalled()
    expect(takeCancel).not.toHaveBeenCalled()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(takeCancel).toHaveBeenCalledTimes(1)
  })

  it('shows the countdown and elapsed time; Space stops while recording', async () => {
    renderRecorder(plain)
    await chooseAudio()
    fireEvent.click(screen.getByRole('button', { name: '● Kaydet' }))
    await waitFor(() => expect(startTakeMock).toHaveBeenCalledTimes(1))
    const o = lastOptions()
    act(() => {
      o.onState('countingIn')
      o.onCountdown(3)
    })
    expect(screen.getByRole('dialog')).toHaveTextContent('3')
    act(() => {
      o.onState('recording')
      o.onElapsed(42.4)
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByText('● 0:42')).toBeInTheDocument()
    fireEvent.keyDown(document.body, { key: ' ' })
    expect(takeStop).toHaveBeenCalledTimes(1)
  })

  it('calls onSaved when the take is written', async () => {
    const { onSaved } = renderRecorder(plain)
    await chooseAudio()
    fireEvent.click(screen.getByRole('button', { name: '● Kaydet' }))
    await waitFor(() => expect(startTakeMock).toHaveBeenCalledTimes(1))
    await act(async () => finishTake('2026-11-24_21-30-05_ses.webm'))
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('a failed take shows its message and does not call onSaved', async () => {
    const { onSaved } = renderRecorder(plain)
    await chooseAudio()
    fireEvent.click(screen.getByRole('button', { name: '● Kaydet' }))
    await waitFor(() => expect(startTakeMock).toHaveBeenCalledTimes(1))
    await act(async () => {
      lastOptions().onState('error')
      failTake(new Error('Kayıt diske yazılamadı.'))
    })
    expect(screen.getByText('Kayıt diske yazılamadı.')).toBeInTheDocument()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('unmount stops the preview stream and the running take', async () => {
    renderRecorder(plain)
    await chooseAudio()
    fireEvent.click(screen.getByRole('button', { name: '● Kaydet' }))
    await waitFor(() => expect(startTakeMock).toHaveBeenCalledTimes(1))
    cleanup()
    expect(takeStop).toHaveBeenCalledTimes(1)
    expect(stopTrack).toHaveBeenCalled()
  })

  it('remembers a newly chosen output device', async () => {
    renderRecorder(plain)
    await chooseAudio()
    fireEvent.change(screen.getByLabelText('Metronom çıkışı'), { target: { value: '' } })
    expect(localStorage.getItem('mm.out')).toBe('')
  })
})
