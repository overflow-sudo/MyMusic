import { useEffect, useRef, useState } from 'react'
import { audioConstraints, videoConstraints } from '../audio/constraints'
import { listDevices, saveDevice, savedDevice, suggestedOutput, type DeviceKind } from '../audio/devices'
import { decodeTrack, startTake, type Take, type TakeOptions } from '../audio/engine'
import type { SessionState } from '../audio/sessionMachine'
import { shortcutAction } from '../audio/shortcuts'
import { formatTimecode } from '../domain/time'
import type { RecordingKind, Song } from '../domain/types'
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
}

const TRACK_MISSING = 'Parça dosyası bulunamadı, parçasız kaydediliyor.'
const TRACK_PAST_END = 'Başlangıç noktası parçanın sonundan sonra, parçasız kaydediliyor.'
const TRACK_UNDECODABLE = 'Parça dosyası okunamadı, parçasız kaydediliyor.'

type Devices = { mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[]; outs: MediaDeviceInfo[] }
const noDevices: Devices = { mics: [], cams: [], outs: [] }
const errName = (e: unknown) => (e instanceof Error || e instanceof DOMException ? e.name : '')

async function mediaErrorMessage(e: unknown, kind: RecordingKind): Promise<string> {
  const name = errName(e)
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return kind === 'video' ? 'Kamera ve mikrofona erişim izni verilmedi.' : 'Mikrofona erişim izni verilmedi.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    if (kind === 'ses') return 'Mikrofon bulunamadı.'
    const d = await listDevices().catch(() => noDevices)
    return d.mics.length === 0 && d.cams.length > 0 ? 'Mikrofon bulunamadı.' : 'Kamera bulunamadı.'
  }
  if (name === 'NotReadableError') return 'Cihaz açılamadı; başka bir uygulama kullanıyor olabilir.'
  return 'Cihaz açılamadı.'
}

function openStream(kind: RecordingKind, mic: string, cam: string) {
  return navigator.mediaDevices.getUserMedia({
    audio: audioConstraints(mic || undefined),
    video: kind === 'video' ? videoConstraints(cam || undefined) : false,
  })
}

const stopStream = (s: MediaStream | null) => s?.getTracks().forEach((t) => t.stop())

export default function Recorder({ song, root, latencyMs, onSaved }: Props) {
  const [mode, setMode] = useState<RecordingKind | null>(null)
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

  const mounted = useRef(true)
  const streamRef = useRef<MediaStream | null>(null)
  const acquireSeq = useRef(0)
  const take = useRef<Take | null>(null)
  const starting = useRef(false)
  const sessionRef = useRef<SessionState>('idle')
  const decoded = useRef<{ key: string; buffer: AudioBuffer } | null>(null)

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
    if (mode) void acquire(mode, kind === 'mic' ? id : mic, kind === 'cam' ? id : cam)
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
    if (!mode || !input || take.current || starting.current || (st !== 'idle' && st !== 'error')) return
    starting.current = true
    setError(null)
    setNotices([])
    setElapsed(0)
    try {
      const track = await loadTrack()
      if (!mounted.current || streamRef.current !== input) return
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
      })
      take.current = t
      t.done
        .then(
          (name) => name && onSaved(),
          (e: unknown) => mounted.current && setError(e instanceof Error ? e.message : 'Kayıt başarısız oldu.'),
        )
        .finally(() => {
          if (take.current === t) take.current = null
        })
    } finally {
      starting.current = false
    }
  }

  // Latest start() for the window listener, which is registered once.
  const startRef = useRef(start)
  useEffect(() => {
    startRef.current = start
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : document.body
      const typing = shortcutAction(' ', 'idle', target) === null
      // Space is the record key: never let it also "click" a focused button or scroll.
      if (e.key === ' ' && !typing) e.preventDefault()
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
    return () => {
      mounted.current = false
      // Latest values are intended: the take/stream running at unmount are the ones to stop.
      acquireSeq.current++ // eslint-disable-line react-hooks/exhaustive-deps
      take.current?.stop() // saves a running take, cancels a count-in
      stopStream(streamRef.current)
      streamRef.current = null
    }
  }, [])

  const busy = session === 'countingIn' || session === 'recording' || session === 'finalizing'
  const canStart = !!mode && !!stream && !busy

  return (
    <section className="recorder">
      <div className="row">
        <button aria-pressed={mode === 'ses'} disabled={busy} onClick={() => chooseMode('ses')}>
          🎙 Ses kaydı
        </button>
        <button aria-pressed={mode === 'video'} disabled={busy} onClick={() => chooseMode('video')}>
          🎥 Video kaydı
        </button>
      </div>
      {mode && (
        <>
          <DeviceSelectors
            {...devices}
            mic={mic}
            cam={cam}
            out={out ?? ''}
            showCam={mode === 'video'}
            disabled={busy}
            onChange={changeDevice}
          />
          {mode === 'video' && stream && <Preview stream={stream} />}
          {stream && <LevelMeter stream={stream} />}
          <div className="row">
            {session === 'finalizing' ? (
              <button disabled>Kaydediliyor…</button>
            ) : busy ? (
              <button
                className="record stop"
                onClick={(e) => {
                  e.currentTarget.blur()
                  take.current?.stop()
                }}
              >
                ■ Durdur
              </button>
            ) : (
              <button
                className="record"
                disabled={!canStart}
                onClick={(e) => {
                  e.currentTarget.blur()
                  void start()
                }}
              >
                ● Kaydet
              </button>
            )}
            {session === 'recording' && <span className="elapsed">● {formatTimecode(elapsed)}</span>}
            {!busy && <span className="muted">Boşluk: başlat / durdur</span>}
          </div>
        </>
      )}
      {notices.map((n) => (
        <p key={n} className="note" role="status">
          {n}
        </p>
      ))}
      {error && (
        <p className="note" role="alert">
          {error}
        </p>
      )}
      {session === 'countingIn' && <CountdownOverlay beatsLeft={beats} onCancel={() => take.current?.cancel()} />}
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
