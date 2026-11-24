import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { formatTimecode } from '../domain/time'
import { measureDuration } from './measureDuration'
import { claimPlayback, register } from './mediaCoordinator'

export interface PlayerProps {
  src: string
  kind: 'audio' | 'video'
  autoPlay?: boolean
  /** 0..1, applied to the media element. */
  volume?: number
  onTime?(sec: number): void
  extra?: ReactNode
}

const STEP = 5

export default function Player({ src, kind, autoPlay, volume, onTime, extra }: PlayerProps) {
  const ref = useRef<HTMLAudioElement & HTMLVideoElement>(null)
  const probedSrc = useRef<string | null>(null)
  const onTimeRef = useRef(onTime)
  const [time, setTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    onTimeRef.current = onTime
  })

  useEffect(() => {
    setTime(0)
    setDuration(0)
    probedSrc.current = null
  }, [src])

  useEffect(() => {
    const el = ref.current
    return el ? register(el) : undefined
  }, [])

  useEffect(() => {
    if (ref.current && volume !== undefined) ref.current.volume = Math.min(1, Math.max(0, volume))
  }, [volume])

  const readDuration = () => {
    const el = ref.current
    if (!el) return
    const d = el.duration
    if (Number.isFinite(d)) setDuration(d)
    else if (d === Infinity && probedSrc.current !== src) {
      // MediaRecorder webm: measure on a detached element so the live one is never seeked (autoplay keeps playing).
      probedSrc.current = src
      void measureDuration(src, kind === 'video' ? 'video' : 'ses').then((m) => {
        if (probedSrc.current !== src) return
        if (m === null) probedSrc.current = null // failed or timed out: a later duration event may retry
        else setDuration(m)
      })
    }
  }

  const update = () => {
    const el = ref.current
    if (!el) return
    setTime(el.currentTime)
    onTimeRef.current?.(el.currentTime)
  }

  const seek = (sec: number) => {
    const el = ref.current
    if (!el || !Number.isFinite(sec)) return
    const max = Number.isFinite(el.duration) ? el.duration : duration || Infinity
    const t = Math.min(Math.max(0, sec), max)
    el.currentTime = t
    setTime(t)
    onTimeRef.current?.(t)
  }

  const toggle = () => {
    const el = ref.current
    if (!el) return
    if (el.paused) void Promise.resolve(el.play()).catch(() => {})
    else el.pause()
  }

  const onRangeKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== ' ') return
    e.preventDefault()
    toggle()
  }

  const shared = {
    ref,
    src,
    autoPlay,
    preload: 'metadata' as const,
    onLoadedMetadata: readDuration,
    onDurationChange: readDuration,
    onTimeUpdate: update,
    onSeeked: update,
    onPlay: () => {
      // Refused during a take: the coordinator paused the element again, so stay on "paused".
      if (ref.current && !claimPlayback(ref.current)) return
      setPlaying(true)
    },
    onPause: () => setPlaying(false),
    onEnded: () => setPlaying(false),
  }

  return (
    <div className="player" data-player data-kind={kind}>
      {kind === 'video' ? <video className="player-video" playsInline {...shared} /> : <audio {...shared} />}
      <div className="player-row">
        <button type="button" className="icon-btn" aria-label="5 saniye geri" onClick={() => seek((ref.current?.currentTime ?? 0) - STEP)}>
          −5
        </button>
        <button type="button" className="icon-btn player-play" aria-label={playing ? 'Duraklat' : 'Oynat'} onClick={toggle}>
          {playing ? '❚❚' : '▶'}
        </button>
        <button type="button" className="icon-btn" aria-label="5 saniye ileri" onClick={() => seek((ref.current?.currentTime ?? 0) + STEP)}>
          +5
        </button>
        <input
          type="range"
          className="player-seek"
          aria-label="Konum"
          aria-valuetext={`${formatTimecode(time)} / ${formatTimecode(duration)}`}
          min={0}
          max={duration || 0}
          step={0.1}
          value={Math.min(time, duration || 0)}
          onChange={(e) => seek(Number(e.target.value))}
          onKeyDown={onRangeKey}
          style={{ '--p': duration ? `${Math.min(100, (time / duration) * 100)}%` : '0%' } as React.CSSProperties}
        />
        <span className="player-time">
          {formatTimecode(time)} / {formatTimecode(duration)}
        </span>
        {extra}
      </div>
    </div>
  )
}
