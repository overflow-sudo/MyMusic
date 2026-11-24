import { useEffect, useState } from 'react'
import { lightBus } from '../light/lightBus'
import { breath, freePhase, hueForBpm, pulseFromPhase, takePhase } from '../light/lightMath'
import { getLightMode, onLightModeChange, type LightMode } from '../light/lightPrefs'

const DEFAULT_HUE = 205
const SMOOTH_MS = 90

const prefersReducedMotion = () => {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

const baseHue = () => {
  const bpm = lightBus.getHueBpm()
  return bpm === null ? DEFAULT_HUE : hueForBpm(bpm)
}

/** Beat pulse 0..1 for the current bus source. */
function currentPulse(nowMs: number): number {
  const s = lightBus.getSource()
  if (s.kind === 'breath') return breath(nowMs)
  if (s.kind === 'free') return pulseFromPhase(freePhase(nowMs, s.bpm))
  const ph = takePhase(s.ctx.currentTime, s.plan)
  return ph === null ? 0 : pulseFromPhase(ph)
}

/** Fixed full-viewport light behind all content; only reads the bus and writes CSS variables. */
export default function LightLayer() {
  const [mode, setMode] = useState<LightMode>(getLightMode)
  useEffect(() => onLightModeChange(setMode), [])

  useEffect(() => {
    if (mode === 'off') return
    const style = document.documentElement.style
    if (prefersReducedMotion()) {
      style.setProperty('--beat-h', baseHue().toFixed(1))
      style.setProperty('--beat-a', '0.3')
      style.setProperty('--beat-s', '0.3')
      style.setProperty('--lvl', '0')
      return
    }
    let id = 0
    let last: number | null = null
    let smooth = 0
    const tick = (t: number) => {
      const a = currentPulse(t)
      const lvl = Math.min(1, Math.max(0, lightBus.getLevel()))
      // Softened pulse (short attack) for the full-screen wash: no hard flashes.
      const dt = last === null ? SMOOTH_MS : Math.max(0, t - last)
      last = t
      smooth += (a - smooth) * (1 - Math.exp(-dt / SMOOTH_MS))
      style.setProperty('--beat-h', (baseHue() + lvl * 30).toFixed(1))
      style.setProperty('--beat-a', a.toFixed(3))
      style.setProperty('--beat-s', smooth.toFixed(3))
      style.setProperty('--lvl', lvl.toFixed(3))
      id = requestAnimationFrame(tick)
    }
    id = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(id)
  }, [mode])

  return <div aria-hidden="true" className={`light-layer${mode === 'off' ? '' : ` light-${mode}`}`} hidden={mode === 'off'} />
}
