import { useEffect, useRef, useState } from 'react'
import { formatTimecode } from '../domain/time'
import type { Song } from '../domain/types'
import type { FsDir } from '../storage/fsDir'
import Player from './Player'
import { measureDuration } from './measureDuration'
import RecordingActions, { downloadFile, downloadUrl } from './RecordingActions'
import RecordingStatusIcon from './RecordingStatusIcon'
import ShareControl from './ShareControl'
import { useSongRecordings, type RecordingCloud, type RecordingRow } from './useSongRecordings'
import { deleteRecording, songDir } from '../storage/repo'

export type { RecordingCloud } from './useSongRecordings'

interface Props {
  root: FsDir
  song: Song
  /** Called after a recording was deleted (the parent refreshes counts). */
  onChanged?: () => void
  /** Element id that receives focus when the last recording is deleted. */
  headingId?: string
  /** Set while a cloud session exists: Sil also deletes the recording on the server (after the local file). */
  cloud?: RecordingCloud
}

const CLOUD_CONFIRM = 'Bu kayıt bu bilgisayardan ve buluttan silinsin mi?'

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

/** Signed URLs last 1 h; one older than this is fetched again. */
const URL_MAX_AGE_MS = 50 * 60_000

interface RowProps {
  root: FsDir
  song: Song
  row: RecordingRow
  api: RecordingCloud['api']
  onDelete: () => Promise<void>
  confirmText?: string
}

function Row({ root, song, row, api, onDelete, confirmText }: RowProps) {
  const [playUrl, setPlayUrl] = useState<{ url: string; blob: boolean } | null>(null)
  const [duration, setDuration] = useState<number | null>(row.remote?.durationSec ?? null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<{ text: string; url?: string; error?: boolean } | null>(null)
  const signed = useRef<{ url: string; at: number } | null>(null)
  const { fileName, kind } = row

  useEffect(() => {
    if (!row.local || typeof URL.createObjectURL !== 'function') return
    let cancelled = false
    let url: string | null = null
    void (async () => {
      try {
        const file = await openFile(root, song, fileName)
        if (!file || cancelled) return
        url = URL.createObjectURL(file)
        const d = await measureDuration(url, kind)
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
  }, [root, song.folderName, fileName, row.local]) // eslint-disable-line react-hooks/exhaustive-deps -- song object changes on every patch

  useEffect(() => {
    if (!notice || notice.url) return
    const t = setTimeout(() => setNotice(null), 4000)
    return () => clearTimeout(t)
  }, [notice])

  useEffect(
    () => () => {
      if (playUrl?.blob) URL.revokeObjectURL(playUrl.url)
    },
    [playUrl],
  )

  const signedUrl = async (download: boolean): Promise<string> => {
    if (!api) throw new Error('no cloud')
    if (!download && signed.current && Date.now() - signed.current.at < URL_MAX_AGE_MS) return signed.current.url
    const { url } = await (download ? api.getRecordingUrl(row.id, { download: true }) : api.getRecordingUrl(row.id))
    if (!download) signed.current = { url, at: Date.now() }
    return url
  }

  const toggle = async () => {
    if (playUrl) return setPlayUrl(null)
    setError(null)
    try {
      if (row.local) {
        const file = await openFile(root, song, fileName)
        if (!file) return setError('Kayıt açılamadı.')
        setPlayUrl({ url: URL.createObjectURL(file), blob: true })
      } else {
        setPlayUrl({ url: await signedUrl(false), blob: false })
      }
    } catch {
      setError('Kayıt açılamadı.')
    }
  }

  const download = async () => {
    setError(null)
    try {
      if (row.local) {
        const file = await openFile(root, song, fileName)
        if (!file) return setError('Kayıt açılamadı.')
        downloadFile(file, fileName)
      } else {
        downloadUrl(await signedUrl(true), fileName)
      }
    } catch {
      setError('Kayıt açılamadı.')
    }
  }

  return (
    <li className="recording">
      <div className="recording-head">
        <button className="recording-row" data-file={fileName} onClick={() => void toggle()} aria-expanded={playUrl !== null}>
          <span>{formatRecordingDate(row.date)}</span>
          <span>{kind}</span>
          <span>{duration === null ? '' : formatTimecode(duration)}</span>
        </button>
        {row.status && <RecordingStatusIcon status={row.status} />}
        <RecordingActions
          onDownload={download}
          onDelete={onDelete}
          confirmText={confirmText}
          extra={api && <ShareControl api={api} id={row.remote ? row.id : null} shared={row.remote?.shared ?? false} onNotice={setNotice} />}
        />
      </div>
      {error && <p className="note" role="alert">{error}</p>}
      {notice && (
        <p className={notice.error ? 'note' : 'recording-notice'} role={notice.error ? 'alert' : 'status'}>
          {notice.text}
          {notice.url && <input className="recording-share-url" readOnly value={notice.url} aria-label="Paylaşım bağlantısı" onFocus={(e) => e.currentTarget.select()} />}
        </p>
      )}
      {playUrl && <Player src={playUrl.url} kind={kind === 'video' ? 'video' : 'audio'} autoPlay />}
    </li>
  )
}

export default function RecordingList({ root, song, onChanged, headingId, cloud }: Props) {
  const { rows, hide } = useSongRecordings(root, song, cloud)
  const focusAfter = useRef<{ file: string | null } | null>(null)

  // After a delete: focus the next row's main control, else the list heading.
  useEffect(() => {
    const f = focusAfter.current
    if (!f || rows === null) return
    focusAfter.current = null
    const btn = f.file ? [...document.querySelectorAll<HTMLElement>('.recording-row')].find((b) => b.dataset.file === f.file) : null
    if (btn) btn.focus()
    else if (headingId) document.getElementById(headingId)?.focus()
  }, [rows, headingId])

  const remove = async (row: RecordingRow) => {
    // Queued first, so the server delete is never forgotten; then the local file; then the server (background).
    const op = cloud ? await cloud.prepareDelete(song, row.fileName).catch(() => null) : null
    if (!op && !row.local) throw new Error('server delete not queued')
    if (row.local) {
      try {
        await deleteRecording(root, song, row.fileName)
      } catch (e) {
        await op?.cancel()
        throw e
      }
    }
    void op?.send()
    const list = rows ?? []
    const i = list.findIndex((e) => e.id === row.id)
    const rest = list.filter((e) => e.id !== row.id)
    focusAfter.current = { file: (rest[i] ?? rest[i - 1])?.fileName ?? null }
    hide(row.id)
    onChanged?.()
  }

  if (rows === null) return null
  if (rows.length === 0) return <p className="muted">Henüz kayıt yok.</p>
  return (
    <ul className="recordings">
      {rows.map((r) => (
        <Row
          key={r.id} root={root} song={song} row={r} api={cloud?.api}
          onDelete={() => remove(r)}
          confirmText={cloud && (!cloud.api || r.remote) ? CLOUD_CONFIRM : undefined}
        />
      ))}
    </ul>
  )
}
