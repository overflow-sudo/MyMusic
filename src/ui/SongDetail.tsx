import { useEffect, useRef, useState, type ReactNode } from 'react'
import { validateSongInput } from '../domain/validate'
import type { Song, SongStatus, Track } from '../domain/types'
import type { FsDir } from '../storage/fsDir'
import { importTrack, readTrack, removeTrack } from '../storage/repo'
import Drawer from './Drawer'
import LightModeSegment from './LightModeSegment'
import RecordingList from './RecordingList'
import SongForm, { type SongInput } from './SongForm'
import TrackPanel from './TrackPanel'

interface Props {
  song: Song
  root: FsDir
  onBack: () => void
  patchSong: (id: string, patch: Partial<Song>) => Promise<void>
  deleteSong: (id: string) => Promise<void>
  /** Slot where the recorder is mounted; shown in the stage area. A function also learns whether the drawer is open. */
  recorder?: ReactNode | ((drawerOpen: boolean) => ReactNode)
  /** Extra content for the drawer's device section (the Recorder portals into #device-settings). */
  drawerSlot?: ReactNode
  /** Bumped by the parent when a take was saved, so the list reloads. */
  recordingsVersion?: number
  /** A take is running: the settings gear is disabled so the take can't be hidden behind a dialog. */
  busy?: boolean
}

const STATUS: { value: SongStatus; label: string }[] = [
  { value: 'learning', label: 'Çalıştığım' },
  { value: 'known', label: 'Bildiğim' },
]
// Status words are Turkish (ı → I, i → İ); artist names are often not ("Oasis" must not become "OASİS").
const upperTr = (s: string) => s.toLocaleUpperCase('tr-TR')

export default function SongDetail({ song, root, onBack, patchSong, deleteSong, recorder, drawerSlot, recordingsVersion = 0, busy = false }: Props) {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const [bpm, setBpm] = useState(String(song.bpm))
  const [beats, setBeats] = useState(String(song.countInBeats))
  const [errors, setErrors] = useState<{ bpm?: string; countInBeats?: string }>({})
  const [trackVersion, setTrackVersion] = useState(0)
  const editButton = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(false)
  // Leaving the form puts focus back on Düzenle instead of dropping it to the page.
  useEffect(() => {
    if (wasEditing.current && !editing && drawerOpen) editButton.current?.focus()
    wasEditing.current = editing
  }, [editing, drawerOpen])

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
      setTrackVersion((v) => v + 1)
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

  const statusLabel = STATUS.find((s) => s.value === song.status)?.label ?? ''
  const meta = [song.artist.toUpperCase(), upperTr(statusLabel)].filter(Boolean).join(' · ')

  return (
    <main className="screen song-detail">
      {/* The page behind the open drawer is inert, so focus stays in the drawer (display: contents keeps the layout). */}
      <div className="song-page" inert={drawerOpen}>
        <header className="song-head">
          <button type="button" className="icon-btn back" aria-label="Geri" onClick={onBack}>
            ‹
          </button>
          <div className="song-head-main">
            <h1 className="song-head-title">{song.title}</h1>
            <p className="song-head-meta">
              {meta}
              {song.track && (
                <>
                  {' · PARÇA: '}
                  <span className="song-head-file">{song.track.fileName}</span>
                </>
              )}
            </p>
          </div>
          <div className="song-head-tempo">
            <span className="song-head-bpm">{song.bpm}</span>
            <span className="song-head-unit">BPM · {song.countInBeats} VURUŞ</span>
          </div>
          <button
            type="button"
            className="icon-btn gear"
            aria-label="Şarkı ayarları"
            aria-expanded={drawerOpen}
            disabled={busy}
            onClick={() => setDrawerOpen(true)}
          >
            ⚙
          </button>
        </header>

        {recorder && <div className="recorder-slot">{typeof recorder === 'function' ? recorder(drawerOpen) : recorder}</div>}

        <section className="song-recordings">
          <h2>Kayıtlar</h2>
          <RecordingList key={recordingsVersion} root={root} song={song} />
        </section>
      </div>

      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} title={editing ? 'Şarkıyı düzenle' : 'Şarkı ayarları'}>
        {editing && (
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
        )}
        {/* Hidden while editing (not unmounted) so the track preview and device section keep their state. */}
        <div className="drawer-sections" hidden={editing}>
          {saveError && (
            <p className="note" role="alert">
              Kaydedilemedi, tekrar dene.
            </p>
          )}
          <section className="drawer-section">
            <h3 className="drawer-label">Durum</h3>
            <div className="seg" role="group" aria-label="Durum">
              {STATUS.map((s) => (
                <button key={s.value} type="button" aria-pressed={song.status === s.value} onClick={() => song.status !== s.value && void save({ status: s.value })}>
                  {s.label}
                </button>
              ))}
            </div>
          </section>
          <section className="drawer-section">
            <h3 className="drawer-label">Tempo</h3>
            <div className="drawer-number">
              <input
                aria-label="Tempo (BPM)"
                inputMode="numeric"
                value={bpm}
                onChange={(e) => setBpm(e.target.value)}
                onBlur={() => commitNumber('bpm', bpm, setBpm)}
              />
              <span className="dim">BPM</span>
            </div>
            {errors.bpm && (
              <p className="note" role="alert">
                {errors.bpm}
              </p>
            )}
          </section>
          <section className="drawer-section">
            <h3 className="drawer-label">Sayım</h3>
            <div className="drawer-number">
              <input
                aria-label="Sayım (vuruş)"
                inputMode="numeric"
                value={beats}
                onChange={(e) => setBeats(e.target.value)}
                onBlur={() => commitNumber('countInBeats', beats, setBeats)}
              />
              <span className="dim">vuruş</span>
            </div>
            {errors.countInBeats && (
              <p className="note" role="alert">
                {errors.countInBeats}
              </p>
            )}
          </section>
          <section className="drawer-section">
            <h3 className="drawer-label">Parça</h3>
            <TrackPanel
              track={song.track}
              version={trackVersion}
              onImport={doImport}
              onRemove={doRemove}
              onChange={changeTrack}
              loadFile={() => readTrack(root, song)}
            />
          </section>
          <section className="drawer-section">
            <h3 className="drawer-label">Cihazlar</h3>
            <div id="device-settings">{drawerSlot}</div>
          </section>
          <section className="drawer-section">
            <h3 className="drawer-label">Işık</h3>
            <LightModeSegment />
          </section>
          <section className="drawer-section drawer-actions">
            <button ref={editButton} type="button" className="btn btn-ghost" onClick={() => setEditing(true)}>
              Düzenle
            </button>
            <button type="button" className="danger-link" onClick={() => void doDelete()}>
              Sil
            </button>
          </section>
        </div>
      </Drawer>
    </main>
  )
}
