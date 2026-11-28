import { useCallback, useEffect, useRef, useState } from 'react'
import type { RecordingInfo } from '../../shared/api'
import type { RecordingKind, Song } from '../domain/types'
import { recordingId } from '../cloud/hash'
import type { FsDir } from '../storage/fsDir'
import { listRecordings } from '../storage/repo'

/** What the list needs from the server (a subset of the cloud api). */
export interface RecordingsApi {
  getRecordings(): Promise<Array<RecordingInfo | { id: string; deleted: true }>>
  getRecordingUrl(id: string, o?: { download?: boolean }): Promise<{ url: string }>
  shareRecording(id: string): Promise<{ url: string }>
  unshareRecording(id: string): Promise<void>
}

export interface RecordingCloud {
  /** Queues the server delete before the local file goes; null when there is nothing to do. */
  prepareDelete(song: Song, fileName: string): Promise<{ cancel(): Promise<void>; send(): Promise<void> } | null>
  /** Server access for the merged list (absent: local only, Sil still deletes in the cloud). */
  api?: RecordingsApi
  /** Finished sync passes; a change refetches the cloud list. */
  passes?: number
  /** A sync pass is running now. */
  syncing?: boolean
}

export type RecordingStatus = 'local' | 'uploading' | 'both' | 'processing' | 'failed' | 'cloud'

export interface RecordingRow {
  id: string
  fileName: string
  kind: RecordingKind
  date: Date
  local: boolean
  /** The server's copy (null: not on the server, or no session). */
  remote: RecordingInfo | null
  /** Null without a session or before the first server answer. */
  status: RecordingStatus | null
}

export function useSongRecordings(root: FsDir, song: Song, cloud: RecordingCloud | undefined) {
  const api = cloud?.api
  const passes = cloud?.passes ?? 0
  const syncing = cloud?.syncing ?? false
  const [local, setLocal] = useState<Array<{ id: string; fileName: string; kind: RecordingKind; date: Date }> | null>(null)
  const [remote, setRemote] = useState<RecordingInfo[] | null>(null)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const localSeq = useRef(0)
  const remoteSeq = useRef(0)

  const loadLocal = useCallback(async () => {
    const seq = ++localSeq.current
    let rows: NonNullable<typeof local>
    try {
      const entries = await listRecordings(root, song)
      rows = await Promise.all(entries.map(async (e) => ({ ...e, id: await recordingId(song.id, e.fileName).catch(() => e.fileName) })))
    } catch {
      rows = []
    }
    if (seq === localSeq.current) setLocal(rows)
  }, [root, song.folderName]) // eslint-disable-line react-hooks/exhaustive-deps -- a status/bpm patch must not reload

  const loadRemote = useCallback(async () => {
    if (!api) return
    const seq = ++remoteSeq.current
    try {
      const list = await api.getRecordings()
      if (seq !== remoteSeq.current) return
      setRemote(list.filter((r): r is RecordingInfo => !('deleted' in r) && r.songId === song.id))
    } catch {
      /* offline or failed: keep what is shown; the status line reports it */
    }
  }, [api, song.id])

  useEffect(() => {
    void loadLocal()
    return () => { localSeq.current++ }
  }, [loadLocal])

  useEffect(() => {
    if (!api) setRemote(null)
    void loadRemote()
    return () => { remoteSeq.current++ }
  }, [api, loadRemote])

  // A finished pass may have changed both sides (uploads, tombstones).
  const firstPasses = useRef(passes)
  useEffect(() => {
    if (passes === firstPasses.current) return
    void loadRemote()
    void loadLocal()
  }, [passes]) // eslint-disable-line react-hooks/exhaustive-deps -- only the counter triggers

  const remoteById = new Map((remote ?? []).map((r) => [r.id, r]))
  const rows = new Map<string, RecordingRow>()
  const statusOf = (isLocal: boolean, r: RecordingInfo | null): RecordingStatus | null => {
    if (!api || remote === null) return null
    if (r) return r.status === 'processing' ? 'processing' : r.status === 'failed' ? 'failed' : isLocal ? 'both' : 'cloud'
    return syncing ? 'uploading' : 'local'
  }
  for (const l of local ?? []) {
    const r = remoteById.get(l.id) ?? null
    rows.set(l.id, { ...l, local: true, remote: r, status: statusOf(true, r) })
  }
  for (const r of remote ?? []) {
    if (rows.has(r.id)) continue
    rows.set(r.id, { id: r.id, fileName: r.fileName, kind: r.kind, date: new Date(r.recordedAt), local: false, remote: r, status: statusOf(false, r) })
  }
  const list = [...rows.values()].filter((r) => !hidden.has(r.id)).sort((a, b) => b.date.getTime() - a.date.getTime())

  return {
    rows: local === null ? null : list,
    /** Drops a row at once (after Sil); the server list may still show it until its delete lands. */
    hide: (id: string) => setHidden((h) => new Set(h).add(id)),
    reload: () => { void loadLocal(); void loadRemote() },
  }
}
