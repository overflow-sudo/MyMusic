import { useMemo, useState } from 'react'
import type { Library, SongStatus } from '../domain/types'
import SongForm, { type SongInput } from './SongForm'

export type { SongInput }

interface Props {
  library: Library
  onOpen: (id: string) => void
  onAdd: (input: SongInput) => void | Promise<void>
  recordingCounts: Record<string, number>
}

const TABS: { status: SongStatus; label: string }[] = [
  { status: 'known', label: 'Bildiğim' },
  { status: 'learning', label: 'Çalıştığım' },
]

// Turkish casing maps "I" to "ı", so a plain "OASIS" query would miss "Oasis"; accept either casing scheme.
const matches = (text: string, query: string) =>
  text.toLocaleLowerCase('tr').includes(query.toLocaleLowerCase('tr')) ||
  text.toLowerCase().includes(query.toLowerCase())

export default function SongList({ library, onOpen, onAdd, recordingCounts }: Props) {
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
      .filter((s) => !q || matches(`${s.title} ${s.artist}`, q))
      .sort((a, b) => a.title.localeCompare(b.title, 'tr'))
  }, [library.songs, tab, query])

  if (adding) {
    return (
      <main className="screen">
        <h1>Şarkı ekle</h1>
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
      <div role="tablist" className="row">
        {TABS.map((t) => (
          <button
            key={t.status}
            role="tab"
            aria-selected={tab === t.status}
            className={tab === t.status ? 'active' : undefined}
            onClick={() => setTab(t.status)}
          >
            {`${t.label} (${counts[t.status]})`}
          </button>
        ))}
      </div>
      <input type="search" placeholder="Ara…" aria-label="Ara" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div role="tabpanel" className="rows">
        {library.songs.length === 0 ? (
          <p className="muted">Henüz şarkı yok. + Şarkı ekle ile başla.</p>
        ) : rows.length === 0 ? (
          <p className="muted">Eşleşen şarkı yok.</p>
        ) : (
          rows.map((s) => (
            <button key={s.id} className="song-row" onClick={() => onOpen(s.id)}>
              <span className="song-title">{s.artist ? `${s.title} — ${s.artist}` : s.title}</span>
              <span className="song-bpm">{s.bpm}</span>
              <span className="song-count">{recordingCounts[s.id] ? `${recordingCounts[s.id]} kayıt` : '—'}</span>
              <span aria-hidden="true">›</span>
            </button>
          ))
        )}
      </div>
      <button onClick={() => setAdding(true)}>+ Şarkı ekle</button>
    </main>
  )
}
