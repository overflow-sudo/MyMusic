import { useEffect, useState } from 'react'
import { getLightMode, onLightModeChange, setLightMode, type LightMode } from '../light/lightPrefs'

const LIGHT: { value: LightMode; label: string }[] = [
  { value: 'a', label: 'A · Alttan parıltı' },
  { value: 'c', label: 'C · Tüm ekran' },
  { value: 'off', label: 'Kapalı' },
]

/** The Işık segment (A / C / Kapalı), shared by the song drawer and the settings dialog. */
export default function LightModeSegment() {
  const [light, setLight] = useState<LightMode>(getLightMode)
  useEffect(() => onLightModeChange(setLight), [])
  return (
    <div className="seg seg-wrap" role="group" aria-label="Işık">
      {LIGHT.map((l) => (
        <button key={l.value} type="button" aria-pressed={light === l.value} onClick={() => setLightMode(l.value)}>
          {l.label}
        </button>
      ))}
    </div>
  )
}
