import { useEffect, useRef, useState } from 'react'
import { getLightColor, isHexColor, LIGHT_PRESETS, onLightColorChange, setLightColor } from '../light/lightPrefs'

interface Props {
  /** Selected color: '#rrggbb', or null/'auto' for the first option. */
  value: string | null
  onChange(c: string | null): void
  /** Label of the "no color" option ('Otomatik' globally, 'Genel' per song). */
  noneLabel: string
}

/** Dragging in the native picker only updates a local draft; the value is committed once on the native `change`. */
function ColorInput({ value, onCommit }: { value: string; onCommit(c: string): void }) {
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  const commit = useRef(onCommit)
  useEffect(() => {
    commit.current = onCommit
    setDraft(value)
  }, [onCommit, value])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const on = () => commit.current(el.value.toLowerCase())
    el.addEventListener('change', on)
    return () => el.removeEventListener('change', on)
  }, [])
  return <input ref={ref} type="color" aria-label="Özel renk" value={draft} onChange={(e) => setDraft(e.target.value)} />
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
        <ColorInput value={sel ?? '#3b82f6'} onCommit={onChange} />
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
