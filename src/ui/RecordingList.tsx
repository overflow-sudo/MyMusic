import { useEffect, useState } from 'react'
import { formatTimecode } from '../domain/time'
import type { Song } from '../domain/types'
import type { FsDir } from '../storage/fsDir'
import Player from './Player'
import { measureDuration } from './measureDuration'
import { listRecordings, songDir, type RecordingEntry } from '../storage/repo'

interface Props {
  root: FsDir
  song: Song
}

const dateFormat = new Intl.DateTimeFormat('tr-TR', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
export const formatRecordingDate = (d: Date) => dateFormat.format(d).replace(',', '')

async function openFile(root: FsDir, song: Song, fileName: string): Promise<File | null> {
  return (await songDir(root, song)).readFile(fileName)
}

function Row({ root, song, entry }: { root: FsDir; song: Song; entry: RecordingEntry }) {
  const [playUrl, setPlayUrl] = useState<string | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (typeof URL.createObjectURL !== 'function') return
    let cancelled = false
    let url: string | null = null
    void (async () => {
      try {
        const file = await openFile(root, song, entry.fileName)
        if (!file || cancelled) return
        url = URL.createObjectURL(file)
        const d = await measureDuration(url, entry.kind)
        if (!cancelled) setDuration(d)
      } catch {
        /* duration is optional */
      } finally {
        if (url) URL.revokeObjectURL(url)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [root, song.folderName, entry.fileName]) // eslint-disable-line react-hooks/exhaustive-deps -- song object changes on every patch

  useEffect(
    () => () => {
      if (playUrl) URL.revokeObjectURL(playUrl)
    },
    [playUrl],
  )

  const toggle = async () => {
    if (playUrl) return setPlayUrl(null)
    setError(false)
    try {
      const file = await openFile(root, song, entry.fileName)
      if (!file) return setError(true)
      setPlayUrl(URL.createObjectURL(file))
    } catch {
      setError(true)
    }
  }

  return (
    <li className="recording">
      <button className="recording-row" onClick={() => void toggle()} aria-expanded={playUrl !== null}>
        <span>{formatRecordingDate(entry.date)}</span>
        <span>{entry.kind}</span>
        <span>{duration === null ? '' : formatTimecode(duration)}</span>
      </button>
      {error && <p className="note" role="alert">Kayıt açılamadı.</p>}
      {playUrl && <Player src={playUrl} kind={entry.kind === 'video' ? 'video' : 'audio'} autoPlay />}
    </li>
  )
}

export default function RecordingList({ root, song }: Props) {
  const [entries, setEntries] = useState<RecordingEntry[] | null>(null)

  useEffect(() => {
    let cancelled = false
    listRecordings(root, song).then(
      (r) => !cancelled && setEntries(r),
      () => !cancelled && setEntries([]),
    )
    return () => {
      cancelled = true
    }
  }, [root, song.folderName]) // eslint-disable-line react-hooks/exhaustive-deps -- a status/bpm patch must not reload

  if (entries === null) return null
  if (entries.length === 0) return <p className="muted">Henüz kayıt yok.</p>
  return (
    <ul className="recordings">
      {entries.map((e) => (
        <Row key={e.fileName} root={root} song={song} entry={e} />
      ))}
    </ul>
  )
}
