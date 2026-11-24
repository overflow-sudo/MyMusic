import { useEffect, useState } from 'react'
import { savedDevice } from '../audio/devices'
import { measureAutoLatencyMs } from '../audio/latency'

interface Props {
  /** null = auto */
  value: number | null
  onSave(v: number | null): Promise<void>
  onClose(): void
  /** Measures the auto value; injectable for tests. */
  measureAuto?: () => Promise<number | null>
}

const defaultMeasure = () => measureAutoLatencyMs(savedDevice('out'))

export default function SettingsDialog({ value, onSave, onClose, measureAuto = defaultMeasure }: Props) {
  const [text, setText] = useState(value === null ? '' : String(value))
  const [auto, setAuto] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

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
      <form className="modal" role="dialog" aria-label="Ayarlar" noValidate onSubmit={(e) => void submit(e)}>
        <h2>Ayarlar</h2>
        <label>
          Gecikme telafisi (ms)
          <input type="number" min={0} max={500} step={1} value={text} placeholder="otomatik" onChange={(e) => setText(e.target.value)} />
        </label>
        <p className="muted">
          Boş bırakırsan otomatik: {auto === null ? '—' : `${auto} ms`}. Kayıtta gitar parçadan geride duyuluyorsa değeri artır.
        </p>
        {error && (
          <p className="note" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button type="submit">Kaydet</button>
          <button type="button" onClick={onClose}>
            Vazgeç
          </button>
        </div>
      </form>
    </div>
  )
}
