import { useEffect, useState } from 'react'
import { lightBus } from '../light/lightBus'
import { breath, freePhase, hueFor, pulseFromPhase, takePhase } from '../light/lightMath'
import { getLightMode, onLightModeChange, type LightMode } from '../light/lightPrefs'

const SMOOTH_MS = 90

const prefersReducedMotion = () => {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/** Chosen color's hue (level ignored) or the tempo hue plus level. */
const paintHue = (lvl: number) => hueFor(lightBus.getHueBpm(), lvl, lightBus.getFixedHue())

/** Only a chosen color overrides the CSS default saturation, so auto keeps today's look. */
const paintSat = (style: CSSStyleDeclaration) => {
  const sat = lightBus.getFixedSat()
  if (sat === null) style.removeProperty('--beat-sat')
  else style.setProperty('--beat-sat', `${(sat * 100).toFixed(0)}%`)
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
      const paint = () => {
        style.setProperty('--beat-h', paintHue(0).toFixed(1))
        paintSat(style)
      }
      paint()
      style.setProperty('--beat-a', '0.3')
      style.setProperty('--beat-s', '0.3')
      style.setProperty('--lvl', '0')
      return lightBus.onHueBpmChange(paint)
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
      style.setProperty('--beat-h', paintHue(lvl).toFixed(1))
      paintSat(style)
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
