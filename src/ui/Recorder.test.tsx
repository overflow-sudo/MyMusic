import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { decodeTrack, startTake, type TakeOptions } from '../audio/engine'
import { createSong } from '../domain/library'
import type { Song } from '../domain/types'
import { lightBus } from '../light/lightBus'
import { createMemoryDir } from '../storage/memoryDir'
import { songDir } from '../storage/repo'
import { register } from './mediaCoordinator'
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

function renderRecorder(song: Song, root = createMemoryDir(), onSaved = vi.fn(), extra: React.ReactNode = null) {
  render(
    <>
      <Recorder song={song} root={root} latencyMs={null} onSaved={onSaved} />
      {extra}
    </>,
  )
  return { root, onSaved }
}

/** The song screen opens in ses mode and acquires the mic by itself. */
async function chooseAudio() {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Kaydet' })).toBeEnabled())
  // hidden: the selectors may sit in the (closed, aria-hidden) settings drawer
  await screen.findByRole('option', { name: 'Speakers (M-Audio M-Track Solo)', hidden: true })
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

  it('starting a take pauses every player before startTake', async () => {
    const el = document.createElement('audio')
    const pause = vi.spyOn(el, 'pause').mockImplementation(() => {})
    const off = register(el)
    renderRecorder(plain)
    await chooseAudio()
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(startTakeMock).toHaveBeenCalledTimes(1))
    off()
    expect(pause).toHaveBeenCalled()
    expect(pause.mock.invocationCallOrder[0]).toBeLessThan(startTakeMock.mock.invocationCallOrder[0])
  })

  it('missing track file: Turkish message, records without track', async () => {
    renderRecorder(withTrack(0))
    await chooseAudio()
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(startTakeMock).toHaveBeenCalledTimes(1))
    expect(lastOptions().track).toEqual({ buffer, startSec: 3, volume: 0.7 })
  })

  it('opens in ses mode and asks for the mic once, without a click', async () => {
    renderRecorder(plain)
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(1))
    expect(getUserMedia.mock.calls[0][0]).toMatchObject({ video: false })
    expect(screen.getByRole('button', { name: 'Ses' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Video' })).toHaveAttribute('aria-pressed', 'false')
    await chooseAudio()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })

  it('permission denied on the automatic open: Turkish message, still usable, Kaydet disabled', async () => {
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    renderRecorder(plain)
    expect(await screen.findByText('Mikrofona erişim izni verilmedi.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kaydet' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Video' })).toBeEnabled()
    fireEvent.keyDown(document.body, { key: ' ' })
    await act(async () => {})
    expect(startTakeMock).not.toHaveBeenCalled()
  })

  it('clicking the already selected mode retries the device after a denied permission', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'))
    renderRecorder(plain)
    expect(await screen.findByText('Mikrofona erişim izni verilmedi.')).toBeInTheDocument()
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Ses' }))
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByText('Mikrofona erişim izni verilmedi.')).not.toBeInTheDocument())
  })

  it('hides the stage label during the count-in so it cannot overlap the number', async () => {
    renderRecorder(plain)
    await chooseAudio()
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(startTakeMock).toHaveBeenCalledTimes(1))
    expect(document.querySelector('.stage-label')).not.toBeNull()
    act(() => lastOptions().onState('countingIn'))
    expect(document.querySelector('.stage-label')).toBeNull()
    act(() => lastOptions().onState('recording'))
    expect(document.querySelector('.stage-label')).not.toBeNull()
  })

  it('missing camera shows a Turkish message', async () => {
    renderRecorder(plain)
    await chooseAudio()
    getUserMedia.mockRejectedValue(new DOMException('none', 'NotFoundError'))
    fireEvent.click(screen.getByRole('button', { name: 'Video' }))
    expect(await screen.findByText('Kamera bulunamadı.')).toBeInTheDocument()
    expect(getUserMedia.mock.calls.at(-1)![0]).toMatchObject({ video: expect.anything() })
  })

  it('record button is named Kaydet, then Durdur while the take runs', async () => {
    renderRecorder(plain)
    await chooseAudio()
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(startTakeMock).toHaveBeenCalledTimes(1))
    act(() => lastOptions().onState('recording'))
    expect(screen.getByRole('button', { name: 'Durdur' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Kaydet' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Durdur' }))
    expect(takeStop).toHaveBeenCalledTimes(1)
  })

  it('drives the rhythm light from the take, back to the song tempo when it settles', async () => {
    lightBus.setSource({ kind: 'free', bpm: plain.bpm })
    renderRecorder(plain)
    await chooseAudio()
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(startTakeMock).toHaveBeenCalledTimes(1))
    const ctx = { currentTime: 0 } as BaseAudioContext
    const plan = { clickTimes: [1, 1.6], downbeat: 2.2, bpm: 94 }
    act(() => lastOptions().onBeatPlan!({ ctx, plan }))
    expect(lightBus.getSource()).toEqual({ kind: 'take', ctx, plan })
    await act(async () => finishTake('x.webm'))
    expect(lightBus.getSource()).toEqual({ kind: 'free', bpm: 94 })
  })

  it('a failed take also hands the light back to the song tempo', async () => {
    renderRecorder(plain)
    await chooseAudio()
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(startTakeMock).toHaveBeenCalledTimes(1))
    act(() => lastOptions().onBeatPlan!({ ctx: { currentTime: 0 } as BaseAudioContext, plan: { clickTimes: [], downbeat: 0, bpm: 94 } }))
    await act(async () => failTake(new Error('Kayıt diske yazılamadı.')))
    expect(lightBus.getSource()).toEqual({ kind: 'free', bpm: 94 })
  })

  it('device selectors render inside #device-settings when it exists, inline otherwise', async () => {
    renderRecorder(plain, undefined, undefined, <div id="device-settings" data-testid="slot" />)
    await chooseAudio()
    const slot = screen.getByTestId('slot')
    expect(within(slot).getByLabelText('Mikrofon')).toBeInTheDocument()
    expect(within(slot).getByLabelText('Metronom çıkışı')).toBeInTheDocument()
    expect(document.querySelector('.recorder')!.querySelector('.device-selectors')).toBeNull()
    cleanup()
    renderRecorder(plain)
    await chooseAudio()
    expect(document.querySelector('.recorder .device-selectors')).not.toBeNull()
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

  it('Space on a focused audio/video player does not start a take and is left to the player', async () => {
    renderRecorder(plain, undefined, undefined, (
      <>
        <audio controls data-testid="audio" />
        <video controls data-testid="video" />
        <div data-player>
          <button data-testid="player-btn">Oynat</button>
        </div>
      </>
    ))
    await chooseAudio()
    for (const id of ['audio', 'video', 'player-btn']) expect(fireEvent.keyDown(screen.getByTestId(id), { key: ' ' })).toBe(true)
    await act(async () => {})
    expect(startTakeMock).not.toHaveBeenCalled()
  })

  it('Space on a button inside another dialog does not start a take', async () => {
    renderRecorder(plain, undefined, undefined, (
      <div role="dialog" aria-label="Ayarlar">
        <button>Vazgeç</button>
      </div>
    ))
    await chooseAudio()
    expect(fireEvent.keyDown(screen.getByRole('button', { name: 'Vazgeç' }), { key: ' ' })).toBe(true)
    await act(async () => {})
    expect(startTakeMock).not.toHaveBeenCalled()
  })

  it('shortcuts are off while disabled (settings open), even with focus on the body', async () => {
    const root = createMemoryDir()
    render(<Recorder song={plain} root={root} latencyMs={null} onSaved={() => {}} shortcutsEnabled={false} />)
    await chooseAudio()
    fireEvent.keyDown(document.body, { key: ' ' })
    await act(async () => {})
    expect(startTakeMock).not.toHaveBeenCalled()
  })

  it('Space with focus on the body does nothing while the song drawer is open', async () => {
    const root = createMemoryDir()
    render(
      <SongDetail
        song={plain}
        root={root}
        onBack={() => {}}
        patchSong={async () => {}}
        deleteSong={async () => {}}
        recorder={(drawerOpen) => <Recorder song={plain} root={root} latencyMs={null} onSaved={() => {}} shortcutsEnabled={!drawerOpen} />}
      />,
    )
    await chooseAudio()
    fireEvent.click(screen.getByRole('button', { name: 'Şarkı ayarları' }))
    ;(document.activeElement as HTMLElement | null)?.blur()
    fireEvent.keyDown(document.body, { key: ' ' })
    await act(async () => {})
    expect(startTakeMock).not.toHaveBeenCalled()
  })

  it('Kaydet is disabled with "Hazırlanıyor…" while the track decodes', async () => {
    const song = withTrack(0)
    const root = createMemoryDir()
    await (await songDir(root, song)).writeFile('track.mp3', 'mp3')
    let finishDecode!: (b: AudioBuffer) => void
    decodeMock.mockReturnValue(new Promise((r) => (finishDecode = r)))
    renderRecorder(song, root)
    await chooseAudio()
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(await screen.findByRole('button', { name: 'Hazırlanıyor…' })).toBeDisabled()
    expect(fireEvent.keyDown(document.body, { key: ' ' })).toBe(false)
    await act(async () => finishDecode({ duration: 100 } as AudioBuffer))
    expect(startTakeMock).toHaveBeenCalledTimes(1)
  })

  it('Space again during count-in does nothing, even with the button focused', async () => {
    renderRecorder(plain)
    await chooseAudio()
    fireEvent.keyDown(document.body, { key: ' ' })
    await waitFor(() => expect(startTakeMock).toHaveBeenCalledTimes(1))
    act(() => lastOptions().onState('countingIn'))
    const button = screen.getByRole('button', { name: 'Durdur' })
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
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(startTakeMock).toHaveBeenCalledTimes(1))
    await act(async () => finishTake('2026-11-24_21-30-05_ses.webm'))
    expect(onSaved).toHaveBeenCalledTimes(1)
  })

  it('a failed take shows its message and does not call onSaved', async () => {
    const { onSaved } = renderRecorder(plain)
    await chooseAudio()
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
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
