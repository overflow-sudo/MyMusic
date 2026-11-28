import { useEffect, useState } from 'react'
import { getLightColor, isHexColor, LIGHT_PRESETS, onLightColorChange, setLightColor } from '../light/lightPrefs'

interface Props {
  /** Selected color: '#rrggbb', or null/'auto' for the first option. */
  value: string | null
  onChange(c: string | null): void
  /** Label of the "no color" option ('Otomatik' globally, 'Genel' per song). */
  noneLabel: string
}

export function ColorChoices({ value, onChange, noneLabel }: Props) {
  const sel = isHexColor(value) ? value.toLowerCase() : null
  const preset = LIGHT_PRESETS.some((p) => p.hex === sel)
  return (
    <div className="color-picker" role="group" aria-label="Işık rengi">
      <button type="button" className="color-none" aria-pressed={sel === null} onClick={() => onChange(null)}>
        {noneLabel}
      </button>
      {LIGHT_PRESETS.map((p) => (
        <button
          key={p.hex}
          type="button"
          className="swatch"
          style={{ background: p.hex }}
          aria-label={p.name}
          aria-pressed={sel === p.hex}
          onClick={() => onChange(p.hex)}
        />
      ))}
      <label className={`color-custom${sel !== null && !preset ? ' on' : ''}`}>
        Özel
        <input type="color" aria-label="Özel renk" value={sel ?? '#3b82f6'} onChange={(e) => onChange(e.target.value.toLowerCase())} />
      </label>
    </div>
  )
}

/** Global light color (Otomatik or fixed), stored on this device. */
export default function LightColorPicker() {
  const [color, setColor] = useState(getLightColor)
  useEffect(() => onLightColorChange(setColor), [])
  return <ColorChoices value={color === 'auto' ? null : color} noneLabel="Otomatik" onChange={(c) => setLightColor(c ?? 'auto')} />
}
