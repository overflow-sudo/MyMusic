import { useState } from 'react'
import { validateSongInput } from '../domain/validate'
import type { SongStatus } from '../domain/types'

export interface SongInput {
  title: string
  artist: string
  status: SongStatus
  bpm: number
  countInBeats: number
}

interface Props {
  initial?: Partial<SongInput>
  onSubmit: (input: SongInput) => void | Promise<void>
  onCancel: () => void
}

// Empty or non-numeric text becomes NaN so validation rejects it instead of silently using 0.
const toNumber = (raw: string) => (raw.trim() === '' ? NaN : Number(raw))

export default function SongForm({ initial, onSubmit, onCancel }: Props) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [artist, setArtist] = useState(initial?.artist ?? '')
  const [status, setStatus] = useState<SongStatus>(initial?.status ?? 'learning')
  const [bpm, setBpm] = useState(String(initial?.bpm ?? 100))
  const [beats, setBeats] = useState(String(initial?.countInBeats ?? 4))
  const [errors, setErrors] = useState<ReturnType<typeof validateSongInput>>({})
  const [busy, setBusy] = useState(false)
  const [saveError, setSaveError] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    const input = { title: title.trim(), artist: artist.trim(), status, bpm: toNumber(bpm), countInBeats: toNumber(beats) }
    const found = validateSongInput(input)
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setBusy(true)
    setSaveError(false)
    try {
      await onSubmit(input)
    } catch {
      setSaveError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="song-form" onSubmit={(e) => void submit(e)} noValidate>
      <label>
        Şarkı adı
        <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
      </label>
      {errors.title && <p className="note" role="alert">{errors.title}</p>}
      <label>
        Sanatçı
        <input value={artist} onChange={(e) => setArtist(e.target.value)} />
      </label>
      <label>
        Durum
        <select value={status} onChange={(e) => setStatus(e.target.value as SongStatus)}>
          <option value="learning">Çalıştığım</option>
          <option value="known">Bildiğim</option>
        </select>
      </label>
      <label>
        Tempo (BPM)
        <input inputMode="numeric" value={bpm} onChange={(e) => setBpm(e.target.value)} />
      </label>
      {errors.bpm && <p className="note" role="alert">{errors.bpm}</p>}
      <label>
        Sayım (vuruş)
        <input inputMode="numeric" value={beats} onChange={(e) => setBeats(e.target.value)} />
      </label>
      {errors.countInBeats && <p className="note" role="alert">{errors.countInBeats}</p>}
      {saveError && <p className="note" role="alert">Kaydedilemedi, tekrar dene.</p>}
      <div className="row">
        <button type="submit" disabled={busy}>Kaydet</button>
        <button type="button" onClick={onCancel}>Vazgeç</button>
      </div>
    </form>
  )
}
