import { useEffect, useRef, useState } from 'react'
import { formatTimecode, parseTimecode } from '../domain/time'
import type { Track } from '../domain/types'
import Player from './Player'

interface Props {
  track: Track | undefined
  onImport: (file: File) => Promise<void>
  onRemove: () => Promise<void>
  onChange: (track: Track) => Promise<void>
  /** Reads the track file for the preview player. */
  loadFile?: () => Promise<File | null>
  /** Bumped by the parent after each import, so a replaced file with the same name is reloaded. */
  version?: number
}

type Handlers = Omit<Props, 'track' | 'version'>

/** m:ss, plus tenths when the start point has them ("Buradan başla" saves to 0.1 s). */
export function formatStart(sec: number): string {
  const tenths = Math.round(sec * 10)
  const whole = Math.floor(tenths / 10)
  return tenths % 10 ? `${formatTimecode(whole)}.${tenths % 10}` : formatTimecode(whole)
}

export default function TrackPanel({ track, onImport, onRemove, onChange, loadFile, version = 0 }: Props) {
  return (
    <div className="track-panel">
      {track ? (
        // Keyed so start-point text/error and the preview never outlive the file they belong to.
        <TrackControls
          key={`${track.fileName}:${version}`}
          track={track}
          onImport={onImport}
          onRemove={onRemove}
          onChange={onChange}
          loadFile={loadFile}
        />
      ) : (
        <FilePick label="Parça seç" primary onImport={onImport} />
      )}
    </div>
  )
}

/** A styled button over a hidden file input, so no browser-default "Choose File" control shows. */
function FilePick({ label, primary, onImport }: { label: string; primary?: boolean; onImport: Handlers['onImport'] }) {
  const input = useRef<HTMLInputElement>(null)
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void onImport(file)
  }
  return (
    <>
      <button type="button" className={primary ? 'btn btn-primary' : 'btn btn-ghost'} onClick={() => input.current?.click()}>
        {label}
      </button>
      <input ref={input} type="file" accept="audio/*" aria-label={label} onChange={pick} hidden />
    </>
  )
}

function TrackControls({ track, onImport, onRemove, onChange, loadFile }: { track: Track } & Handlers) {
  const [start, setStart] = useState(formatStart(track.startSec))
  const [startError, setStartError] = useState(false)
  const [volume, setVolume] = useState(Math.round(track.volume * 100))
  const [url, setUrl] = useState<string | null>(null)
  const now = useRef(0)
  useEffect(() => setStart(formatStart(track.startSec)), [track.startSec])
  useEffect(() => setVolume(Math.round(track.volume * 100)), [track.volume])

  // One object URL per mounted file; revoked when the file changes (remount via key) or the panel unmounts.
  useEffect(() => {
    if (!loadFile || typeof URL.createObjectURL !== 'function') return
    let cancelled = false
    let made: string | null = null
    loadFile().then(
      (file) => {
        if (cancelled || !file) return
        made = URL.createObjectURL(file)
        setUrl(made)
      },
      () => {},
    )
    return () => {
      cancelled = true
      if (made) URL.revokeObjectURL(made)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- remounted (keyed) for a new file

  const commitStart = () => {
    // Untouched text keeps the exact saved value (it may carry tenths the field rounds away).
    if (start === formatStart(track.startSec)) return setStartError(false)
    const sec = parseTimecode(start)
    if (sec === null) return setStartError(true)
    setStartError(false)
    if (sec !== track.startSec) void onChange({ ...track, startSec: sec })
    else setStart(formatStart(sec))
  }
  const startHere = () => {
    const sec = Math.round(now.current * 10) / 10
    setStartError(false)
    setStart(formatStart(sec))
    if (sec !== track.startSec) void onChange({ ...track, startSec: sec })
  }
  // Slider drags only update local state; one save happens when the gesture ends.
  const commitVolume = () => {
    if (volume / 100 !== track.volume) void onChange({ ...track, volume: volume / 100 })
  }

  return (
    <>
      <div className="track-file">
        <span className="track-name">{track.fileName}</span>
        <div className="row">
          <FilePick label="Değiştir" onImport={onImport} />
          <button type="button" className="btn btn-ghost" onClick={() => void onRemove()}>
            Kaldır
          </button>
        </div>
      </div>
      {url && (
        <Player
          src={url}
          kind="audio"
          onTime={(t) => {
            now.current = t
          }}
          extra={
            <button type="button" className="btn btn-ghost start-here" onClick={startHere}>
              Buradan başla
            </button>
          }
        />
      )}
      <div className="track-fields">
        <label className="track-start">
          Başlangıç noktası
          <input value={start} onChange={(e) => setStart(e.target.value)} onBlur={commitStart} />
        </label>
        <label className="track-volume">
          <span>
            Ses seviyesi <span className="track-volume-n">{volume}%</span>
          </span>
          <input
            aria-label="Ses seviyesi"
            type="range"
            min={0}
            max={100}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            onPointerUp={commitVolume}
            onKeyUp={commitVolume}
            onBlur={commitVolume}
          />
        </label>
      </div>
      {startError && (
        <p className="note" role="alert">
          Geçersiz süre
        </p>
      )}
    </>
  )
}
