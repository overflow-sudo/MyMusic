import { useEffect, useRef } from 'react'

const FLOOR_DB = -60

/** RMS input level of the preview stream, -60…0 dBFS. Never connected to the speakers. */
export default function LevelMeter({ stream }: { stream: MediaStream }) {
  const bar = useRef<HTMLDivElement>(null)
  const meter = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (typeof AudioContext === 'undefined') return
    let ctx: AudioContext
    let analyser: AnalyserNode
    try {
      ctx = new AudioContext()
      analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      ctx.createMediaStreamSource(stream).connect(analyser)
      void ctx.resume().catch(() => undefined)
    } catch {
      return
    }
    const buf = new Float32Array(analyser.fftSize)
    let raf = 0
    const tick = () => {
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (const v of buf) sum += v * v
      const rms = Math.sqrt(sum / buf.length)
      const db = rms > 0 ? 20 * Math.log10(rms) : FLOOR_DB
      const frac = Math.min(1, Math.max(0, (db - FLOOR_DB) / -FLOOR_DB))
      if (bar.current) {
        bar.current.style.width = `${frac * 100}%`
        bar.current.classList.toggle('hot', db > -3)
      }
      meter.current?.setAttribute('aria-valuenow', String(Math.round(Math.max(db, FLOOR_DB))))
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => {
      cancelAnimationFrame(raf)
      void ctx.close().catch(() => undefined)
    }
  }, [stream])

  return (
    <div
      ref={meter}
      className="level-meter"
      role="meter"
      aria-label="Giriş seviyesi"
      aria-valuemin={FLOOR_DB}
      aria-valuemax={0}
      aria-valuenow={FLOOR_DB}
    >
      <div ref={bar} className="level-bar" />
    </div>
  )
}
