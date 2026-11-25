import { useMemo, useState } from 'react'
import type { Library, SongStatus } from '../domain/types'
import type { FsDir } from '../storage/fsDir'
import CoverArt from './CoverArt'
import SongForm, { type SongInput } from './SongForm'

export type { SongInput }

interface Props {
  library: Library
  onOpen: (id: string) => void
  onAdd: (input: SongInput) => void | Promise<void>
  recordingCounts: Record<string, number>
  /** Opens the global settings dialog (⚙ in the header). */
  onSettings?: () => void
  /** Library folder; when given, each row starts with the song's cover. */
  root?: FsDir
}

const TABS: { status: SongStatus; label: string }[] = [
  { status: 'learning', label: 'Çalıştığım' },
  { status: 'known', label: 'Bildiğim' },
]

// Turkish casing maps "I" to "ı", so a plain "OASIS" query would miss "Oasis"; accept either casing scheme.
const matches = (text: string, query: string) =>
  text.toLocaleLowerCase('tr').includes(query.toLocaleLowerCase('tr')) ||
  text.toLowerCase().includes(query.toLowerCase())

export default function SongList({ library, onOpen, onAdd, recordingCounts, onSettings, root }: Props) {
  const [tab, setTab] = useState<SongStatus>('learning')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)

  const counts = useMemo(
    () => ({
      known: library.songs.filter((s) => s.status === 'known').length,
      learning: library.songs.filter((s) => s.status === 'learning').length,
    }),
    [library.songs],
  )

  const rows = useMemo(() => {
    const q = query.trim()
    return library.songs
      .filter((s) => s.status === tab)
      .filter((s) => !q || matches(s.title, q) || matches(s.artist, q))
      .sort((a, b) => a.title.localeCompare(b.title, 'tr'))
  }, [library.songs, tab, query])

  if (adding) {
    return (
      <main className="screen narrow">
        <h1 className="display">Şarkı ekle</h1>
        <SongForm
          initial={{ status: tab }}
          onCancel={() => setAdding(false)}
          onSubmit={async (input) => {
            await onAdd(input)
            setAdding(false)
          }}
        />
      </main>
    )
  }

  return (
    <main className="screen song-list">
      <header className="topbar">
        <div role="tablist" className="tabs">
          {TABS.map((t) => (
            <button
              key={t.status}
              role="tab"
              aria-selected={tab === t.status}
              className="tab"
              onClick={() => setTab(t.status)}
            >
              {t.label} <span className="tab-n">{counts[t.status]}</span>
            </button>
          ))}
        </div>
        <div className="topbar-actions">
          <button className="btn btn-ghost" onClick={() => setAdding(true)}>
            ＋ Şarkı
          </button>
          {onSettings && (
            <button className="icon-btn" aria-label="Ayarlar" onClick={onSettings}>
              ⚙
            </button>
          )}
        </div>
      </header>
      <input
        type="search"
        className="search"
        placeholder="Ara"
        aria-label="Ara"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div role="tabpanel" className="rows">
        {library.songs.length === 0 ? (
          <p className="empty">Henüz şarkı yok. ＋ Şarkı ile başla.</p>
        ) : rows.length === 0 ? (
          <p className="empty">Eşleşen şarkı yok.</p>
        ) : (
          rows.map((s) => (
            <button key={s.id} className="song-row" onClick={() => onOpen(s.id)}>
              {root && <CoverArt root={root} song={s} size={40} />}
              <span className="song-main">
                <span className="song-title">{s.title}</span>
                {s.artist && <span className="song-artist">{s.artist}</span>}
              </span>
              <span className="song-meta">
                <em>{s.bpm}</em> BPM · <span className="song-count">{recordingCounts[s.id] ? `${recordingCounts[s.id]} kayıt` : '—'}</span>
              </span>
            </button>
          ))
        )}
      </div>
    </main>
  )
}
