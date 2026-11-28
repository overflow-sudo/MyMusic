import { useEffect, useRef, useState } from 'react'
import { resolveOutputDevice } from '../audio/devices'
import { measureAutoLatencyMs } from '../audio/latency'
import LightColorPicker from './LightColorPicker'
import LightModeSegment from './LightModeSegment'

interface Props {
  /** null = auto */
  value: number | null
  onSave(v: number | null): Promise<void>
  onClose(): void
  /** Measures the auto value; injectable for tests. */
  measureAuto?: () => Promise<number | null>
}

const defaultMeasure = async () => measureAutoLatencyMs(await resolveOutputDevice())

export default function SettingsDialog({ value, onSave, onClose, measureAuto = defaultMeasure }: Props) {
  const [text, setText] = useState(value === null ? '' : String(value))
  const [auto, setAuto] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const dialog = useRef<HTMLFormElement>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  // Focus moves into the dialog on open and returns to the opener on close; Esc closes.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    dialog.current?.querySelector<HTMLElement>('input')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      if (opener?.isConnected) opener.focus()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    measureAuto().then(
      (ms) => !cancelled && setAuto(ms),
      () => undefined,
    )
    return () => {
      cancelled = true
    }
  }, [measureAuto])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    const raw = text.trim()
    const n = raw === '' ? null : Number(raw)
    if (n !== null && !(Number.isInteger(n) && n >= 0 && n <= 500)) {
      setError('0 ile 500 arasında tam sayı gir (boş bırakırsan otomatik).')
      return
    }
    setError(null)
    try {
      await onSave(n)
      onClose()
    } catch {
      setError('Kaydedilemedi, tekrar dene.')
    }
  }

  return (
    <div className="modal-backdrop">
      <form ref={dialog} className="modal" role="dialog" aria-modal="true" aria-label="Ayarlar" noValidate onSubmit={(e) => void submit(e)}>
        <h2>Ayarlar</h2>
        <label>
          Gecikme telafisi (ms)
          <input type="number" min={0} max={500} step={1} value={text} placeholder="otomatik" onChange={(e) => setText(e.target.value)} />
        </label>
        <p className="muted">
          Boş bırakırsan otomatik: {auto === null ? '—' : `${auto} ms`}. Kayıtta gitar parçadan geride duyuluyorsa değeri artır.
        </p>
        <div className="modal-field">
          <h3 className="drawer-label">Işık</h3>
          <LightModeSegment />
          <h3 className="drawer-label">Işık rengi</h3>
          <LightColorPicker />
          <p className="muted">Ritme göre nabız atan ışık. Şarkı ekranındaki ⚙ panelinden de değiştirilebilir.</p>
        </div>
        {error && (
          <p className="note" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit" className="btn btn-primary">
            Kaydet
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Vazgeç
          </button>
        </div>
      </form>
    </div>
  )
}
