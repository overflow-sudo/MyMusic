import { useState, type ReactNode } from 'react'
import { validateSongInput } from '../domain/validate'
import type { Song, SongStatus, Track } from '../domain/types'
import type { FsDir } from '../storage/fsDir'
import { importTrack, removeTrack } from '../storage/repo'
import RecordingList from './RecordingList'
import SongForm, { type SongInput } from './SongForm'
import TrackPanel from './TrackPanel'

interface Props {
  song: Song
  root: FsDir
  onBack: () => void
  patchSong: (id: string, patch: Partial<Song>) => Promise<void>
  deleteSong: (id: string) => Promise<void>
  /** Slot where the recorder is mounted (Task 8). */
  recorder?: ReactNode
  /** Bumped by the parent when a take was saved, so the list reloads. */
  recordingsVersion?: number
}

export default function SongDetail({ song, root, onBack, patchSong, deleteSong, recorder, recordingsVersion = 0 }: Props) {
  const [editing, setEditing] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [bpm, setBpm] = useState(String(song.bpm))
  const [beats, setBeats] = useState(String(song.countInBeats))
  const [errors, setErrors] = useState<{ bpm?: string; countInBeats?: string }>({})

  // Every save funnels through here so a rejected write shows one message instead of an unhandled rejection.
  const save = async (patch: Partial<Song>): Promise<boolean> => {
    setSaveError(false)
    try {
      await patchSong(song.id, patch)
      return true
    } catch {
      setSaveError(true)
      return false
    }
  }

  const commitNumber = (field: 'bpm' | 'countInBeats', raw: string, reset: (s: string) => void) => {
    const value = raw.trim() === '' ? NaN : Number(raw)
    const found = validateSongInput({ title: 'x', bpm: field === 'bpm' ? value : song.bpm, countInBeats: field === 'countInBeats' ? value : song.countInBeats })
    const message = found[field]
    setErrors((e) => ({ ...e, [field]: message }))
    if (message) return
    if (value !== song[field]) void save({ [field]: value })
    else reset(String(value))
  }

  const changeTrack = async (track: Track) => {
    await save({ track })
  }
  const doImport = async (file: File) => {
    setSaveError(false)
    try {
      const track = await importTrack(root, song, file)
      await patchSong(song.id, { track })
    } catch {
      setSaveError(true)
    }
  }
  const doRemove = async () => {
    setSaveError(false)
    try {
      // Patch first: if it fails the song still points at an existing file; an orphan file is harmless.
      await patchSong(song.id, { track: undefined })
      await removeTrack(root, song)
    } catch {
      setSaveError(true)
    }
  }
  const doDelete = async () => {
    if (!window.confirm('Şarkı listeden kaldırılsın mı? Kayıt dosyaların klasörde kalır.')) return
    try {
      await deleteSong(song.id)
      onBack()
    } catch {
      setSaveError(true)
    }
  }

  return (
    <main className="screen song-detail">
      {editing && (
        <>
          <h1>Şarkıyı düzenle</h1>
          <SongForm
            initial={song}
            onCancel={() => setEditing(false)}
            onSubmit={async (input: SongInput) => {
              await patchSong(song.id, { ...input })
              setBpm(String(input.bpm))
              setBeats(String(input.countInBeats))
              setEditing(false)
            }}
          />
        </>
      )}
      {/* Hidden while editing (not unmounted) so a running take is not stopped. */}
      <div hidden={editing}>
      <button onClick={onBack}>‹ Geri</button>
      <h1>{song.artist ? `${song.title} — ${song.artist}` : song.title}</h1>
      <div className="row">
        <label>
          Durum
          <select value={song.status} onChange={(e) => void save({ status: e.target.value as SongStatus })}>
            <option value="known">Bildiğim</option>
            <option value="learning">Çalıştığım</option>
          </select>
        </label>
        <button onClick={() => setEditing(true)}>Düzenle</button>
        <button onClick={() => void doDelete()}>Sil</button>
      </div>
      <div className="row">
        <label>
          Tempo (BPM)
          <input
            inputMode="numeric"
            value={bpm}
            onChange={(e) => setBpm(e.target.value)}
            onBlur={() => commitNumber('bpm', bpm, setBpm)}
          />
        </label>
        <label>
          Sayım (vuruş)
          <input
            inputMode="numeric"
            value={beats}
            onChange={(e) => setBeats(e.target.value)}
            onBlur={() => commitNumber('countInBeats', beats, setBeats)}
          />
        </label>
      </div>
      {errors.bpm && <p className="note" role="alert">{errors.bpm}</p>}
      {errors.countInBeats && <p className="note" role="alert">{errors.countInBeats}</p>}
      {saveError && <p className="note" role="alert">Kaydedilemedi, tekrar dene.</p>}
      <TrackPanel track={song.track} onImport={doImport} onRemove={doRemove} onChange={changeTrack} />
      {recorder && <div className="recorder-slot">{recorder}</div>}
      <h2>Kayıtlar</h2>
      <RecordingList key={recordingsVersion} root={root} song={song} />
      </div>
    </main>
  )
}
