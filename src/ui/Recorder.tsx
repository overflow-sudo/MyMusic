import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { listDevices, saveDevice, savedDevice, suggestedOutput, type DeviceKind } from '../audio/devices'
import { errName, inputLabel, mediaErrorMessage, noDevices, openStream, stopStream, type Devices } from './recorderMedia'
import { decodeTrack, startTake, type Take, type TakeOptions } from '../audio/engine'
import type { SessionState } from '../audio/sessionMachine'
import { pauseAll, setRecording } from './mediaCoordinator'
import { isTypingTarget, shortcutAction } from '../audio/shortcuts'
import { formatTimecode } from '../domain/time'
import type { RecordingKind, Song } from '../domain/types'
import { lightBus } from '../light/lightBus'
import type { FsDir } from '../storage/fsDir'
import { readTrack } from '../storage/repo'
import CountdownOverlay from './CountdownOverlay'
import DeviceSelectors from './DeviceSelectors'
import LevelMeter from './LevelMeter'

interface Props {
  song: Song
  root: FsDir
  /** null = auto */
  latencyMs: number | null
  /** A take was written to disk. */
  onSaved(): void
  /** false while another modal (settings) is open. */
  shortcutsEnabled?: boolean
  /** true while a take is counting in, recording or finalizing. */
  onBusyChange?(busy: boolean): void
}

const TRACK_MISSING = 'Parça dosyası bulunamadı, parçasız kaydediliyor.'
const TRACK_PAST_END = 'Başlangıç noktası parçanın sonundan sonra, parçasız kaydediliyor.'
const TRACK_UNDECODABLE = 'Parça dosyası okunamadı, parçasız kaydediliyor.'

export default function Recorder({ song, root, latencyMs, onSaved, shortcutsEnabled = true, onBusyChange }: Props) {
  const [mode, setMode] = useState<RecordingKind>('ses')
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [devices, setDevices] = useState<Devices>(noDevices)
  const [mic, setMic] = useState(() => savedDevice('mic') ?? '')
  const [cam, setCam] = useState(() => savedDevice('cam') ?? '')
  const [out, setOut] = useState<string | null>(() => savedDevice('out') ?? null)
  const [session, setSession] = useState<SessionState>('idle')
  const [beats, setBeats] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notices, setNotices] = useState<string[]>([])
  const [preparing, setPreparing] = useState(false)

  const mounted = useRef(true)
  const streamRef = useRef<MediaStream | null>(null)
  const acquireSeq = useRef(0)
  const take = useRef<Take | null>(null)
  const starting = useRef(false)
  const sessionRef = useRef<SessionState>('idle')
  const decoded = useRef<{ key: string; buffer: AudioBuffer } | null>(null)
  const bpmRef = useRef(song.bpm)
  // The drawer's device section comes after the recorder in the DOM, so look it up once mounted.
  const [deviceSlot, setDeviceSlot] = useState<HTMLElement | null>(null)

  const releaseStream = () => {
    stopStream(streamRef.current)
    streamRef.current = null
    setStream(null)
  }

  const acquire = async (kind: RecordingKind, micId: string, camId: string): Promise<void> => {
    const seq = ++acquireSeq.current
    releaseStream()
    setError(null)
    let s: MediaStream
    try {
      s = await openStream(kind, micId, camId)
    } catch (e) {
      // A remembered device that was unplugged: fall back to the system default once.
      const gone = errName(e) === 'OverconstrainedError' || errName(e) === 'NotFoundError'
      if (!(gone && (micId || camId))) {
        const msg = await mediaErrorMessage(e, kind)
        if (seq === acquireSeq.current && mounted.current) setError(msg)
        return
      }
      return acquire(kind, '', '').then(() => {
        if (seq + 1 !== acquireSeq.current || !mounted.current) return
        setMic('')
        setCam('')
      })
    }
    if (seq !== acquireSeq.current || !mounted.current) return stopStream(s)
    streamRef.current = s
    setStream(s)
    const d = await listDevices().catch(() => null) // labels are only available after permission
    if (!d || !mounted.current) return
    setDevices(d)
    setOut((o) => o ?? suggestedOutput(d.outs))
  }

  const chooseMode = (kind: RecordingKind) => {
    setMode(kind)
    void acquire(kind, mic, cam)
  }

  const changeDevice = (kind: DeviceKind, id: string) => {
    saveDevice(kind, id)
    if (kind === 'out') return setOut(id)
    if (kind === 'mic') setMic(id)
    else setCam(id)
    void acquire(mode, kind === 'mic' ? id : mic, kind === 'cam' ? id : cam)
  }

  const notify = (m: string) => setNotices((n) => (n.includes(m) ? n : [...n, m]))

  const loadTrack = async (): Promise<TakeOptions['track']> => {
    const t = song.track
    if (!t) return undefined
    const file = await readTrack(root, song).catch(() => null)
    if (!file) return void notify(TRACK_MISSING)
    const key = `${t.fileName}:${file.size}:${file.lastModified}`
    let buffer = decoded.current?.key === key ? decoded.current.buffer : null
    if (!buffer) {
      try {
        buffer = await decodeTrack(file)
      } catch {
        return void notify(TRACK_UNDECODABLE)
      }
      decoded.current = { key, buffer }
    }
    if (t.startSec >= buffer.duration) return void notify(TRACK_PAST_END)
    return { buffer, startSec: t.startSec, volume: t.volume }
  }

  const onState = (s: SessionState) => {
    sessionRef.current = s
    setSession(s)
  }

  const start = async () => {
    const input = streamRef.current
    const st = sessionRef.current
    if (!input || take.current || starting.current || (st !== 'idle' && st !== 'error')) return
    starting.current = true
    setPreparing(true)
    setError(null)
    setNotices([])
    setElapsed(0)
    try {
      const track = await loadTrack()
      if (!mounted.current || streamRef.current !== input) return
      pauseAll() // one medium at a time
      setRecording(true) // and nothing may start playing until the take settles
      const t = startTake({
        kind: mode,
        song,
        root,
        input,
        outputDeviceId: out || undefined,
        track,
        latencyMs,
        onState,
        onCountdown: setBeats,
        onElapsed: setElapsed,
        onNotice: notify,
        // The rhythm light follows the metronome exactly during the take.
        onBeatPlan: ({ ctx, plan }) => {
          if (mounted.current && take.current === t) lightBus.setSource({ kind: 'take', ctx, plan })
        },
      })
      take.current = t
      t.done
        .then(
          (name) => name && onSaved(),
          (e: unknown) => mounted.current && setError(e instanceof Error ? e.message : 'Kayıt başarısız oldu.'),
        )
        .finally(() => {
          if (take.current === t) take.current = null
          setRecording(false)
          // Saved, cancelled or failed: back to the song's free pulse (unless the screen is gone).
          if (mounted.current && lightBus.getSource().kind === 'take') lightBus.setSource({ kind: 'free', bpm: bpmRef.current })
        })
    } finally {
      if (!take.current) setRecording(false) // startTake threw or we bailed out before it
      starting.current = false
      if (mounted.current) setPreparing(false)
    }
  }

  // Latest start() / enabled flag for the window listener, which is registered once.
  const startRef = useRef(start)
  const enabledRef = useRef(shortcutsEnabled)
  useEffect(() => {
    startRef.current = start
    enabledRef.current = shortcutsEnabled
    bpmRef.current = song.bpm
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const st = sessionRef.current
      const running = st === 'countingIn' || st === 'recording'
      // A running take can always be stopped/cancelled; only starting honours the disabled flag and open dialogs.
      if (!enabledRef.current && !running) return
      const target = e.target instanceof HTMLElement ? e.target : document.body
      // Players and fields keep their own Space; other dialogs (settings) block starting, the countdown overlay is ours.
      if (isTypingTarget(target)) return
      const inDialog = !!target.closest('[role="dialog"]:not(.countdown)')
      if ((!enabledRef.current || inDialog) && !running) return
      // Space is the record key: never let it also "click" a focused button or scroll.
      if (e.key === ' ') e.preventDefault()
      if (e.repeat) return
      const action = shortcutAction(e.key, sessionRef.current, target)
      if (!action) return
      e.preventDefault()
      if (action === 'start') void startRef.current()
      else if (action === 'stop') take.current?.stop()
      else take.current?.cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    mounted.current = true
    setDeviceSlot(document.getElementById('device-settings')) // eslint-disable-line react-hooks/set-state-in-effect -- DOM lookup after commit
    // Once, with the saved devices: the song screen opens in ses mode with the mic preview on.
    void acquire('ses', mic, cam)
    return () => {
      mounted.current = false
      // Latest values are intended: the take/stream running at unmount are the ones to stop.
      acquireSeq.current++ // eslint-disable-line react-hooks/exhaustive-deps
      take.current?.stop() // saves a running take, cancels a count-in
      stopStream(streamRef.current)
      streamRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const busy = session === 'countingIn' || session === 'recording' || session === 'finalizing'
  const onBusyRef = useRef(onBusyChange)
  useEffect(() => {
    onBusyRef.current = onBusyChange
  })
  useEffect(() => {
    onBusyRef.current?.(busy)
  }, [busy])
  const canStart = !!stream && !busy && !preparing

  const selectors = (
    <DeviceSelectors
      {...devices}
      mic={mic}
      cam={cam}
      out={out ?? ''}
      showCam={mode === 'video'}
      disabled={busy}
      onChange={changeDevice}
    />
  )

  let recordLabel = 'Kaydet'
  if (session === 'finalizing') recordLabel = 'Kaydediliyor…'
  else if (busy) recordLabel = 'Durdur'
  else if (preparing) recordLabel = 'Hazırlanıyor…'

  return (
    <section className="recorder">
      <div className={`stage rec-stage rec-stage-${mode}`}>
        {mode === 'video' && stream && <Preview stream={stream} />}
        {session !== 'countingIn' && <span className="stage-label">{inputLabel(mode, stream)}</span>}
        {session === 'recording' && <span className="stage-rec elapsed">● {formatTimecode(elapsed)}</span>}
        {session === 'countingIn' && <CountdownOverlay beatsLeft={beats} onCancel={() => take.current?.cancel()} />}
      </div>
      {(notices.length > 0 || error) && (
        <div className="rec-notes">
          {notices.map((n) => (
            <p key={n} className="rec-note" role="status">
              {n}
            </p>
          ))}
          {error && (
            <p className="rec-note rec-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
      <div className="rec-bar">
        <div className="seg rec-mode" role="group" aria-label="Kayıt türü">
          <button type="button" aria-pressed={mode === 'ses'} disabled={busy} onClick={() => (mode !== 'ses' || !stream) && chooseMode('ses')}>
            Ses
          </button>
          <button type="button" aria-pressed={mode === 'video'} disabled={busy} onClick={() => (mode !== 'video' || !stream) && chooseMode('video')}>
            Video
          </button>
        </div>
        <div className="rec-level">{stream ? <LevelMeter stream={stream} /> : <div className="level-meter" aria-hidden="true" />}</div>
        <button
          type="button"
          className={busy ? 'rec-button recording' : 'rec-button'}
          aria-label={recordLabel}
          disabled={session === 'finalizing' || (!busy && !canStart)}
          onClick={(e) => {
            e.currentTarget.blur()
            if (busy) take.current?.stop()
            else void start()
          }}
        >
          <span className="rec-button-mark" aria-hidden="true" />
        </button>
        <span className="rec-hint">Boşluk: başlat / durdur</span>
      </div>
      {deviceSlot ? createPortal(selectors, deviceSlot) : <div className="rec-devices">{selectors}</div>}
    </section>
  )
}

function Preview({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])
  return <video ref={ref} className="preview" autoPlay muted playsInline />
}
