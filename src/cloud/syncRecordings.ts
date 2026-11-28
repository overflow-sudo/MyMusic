import type { Song } from '../domain/types'
import type { FsDir } from '../storage/fsDir'
import { deleteRecording, listRecordings, readSongFile, type RecordingEntry } from '../storage/repo'
import { CloudError, type CloudApi } from './api'
import { uploadBlob } from './chunkedUpload'
import { recordingId } from './hash'
import type { UploadApi } from './syncFiles'

export type RecordingsSyncApi = UploadApi & Pick<CloudApi, 'getRecordings' | 'deleteRecording'>

export interface RecordingsSyncDeps {
  api: RecordingsSyncApi
  root: FsDir
  /** All local songs, tombstones included. */
  getLocalSongs(): Song[]
  getPendingDeletes(): string[]
  /** Removes these ids from library.pendingDeletes (saved). */
  clearPendingDeletes(ids: string[]): Promise<void> | void
  /** True while a take runs: no upload starts. */
  shouldStop(): boolean
  signal?: AbortSignal
  /** False after a rate limit earlier in the pass: deletes and tombstones still run. */
  allowUploads?: boolean
  onProgress?(done: number, total: number): void
}

export interface RecordingsSyncStats {
  deletesSent: number
  /** Local files removed because the server has a tombstone for them. */
  localDeleted: number
  uploaded: number
  /** Rejected for now (song unknown on the server, 409/410): retried next pass. */
  pending: number
  failed: number
  stopped: boolean
  rateLimited: boolean
}

interface LocalRec { song: Song; entry: RecordingEntry; id: string }

const fatal = (e: unknown) => e instanceof CloudError && (e.kind === 'offline' || e.kind === 'auth')
const mimeFor = (kind: RecordingEntry['kind']) => (kind === 'video' ? 'video/webm' : 'audio/webm')

/**
 * Recording deletes, then tombstones, then uploads (one at a time). A local file is only ever deleted because the
 * server lists a tombstone for exactly its id; upload errors never touch it.
 */
export async function syncRecordingsOnce(d: RecordingsSyncDeps): Promise<RecordingsSyncStats> {
  const stats: RecordingsSyncStats = { deletesSent: 0, localDeleted: 0, uploaded: 0, pending: 0, failed: 0, stopped: false, rateLimited: false }
  const stop = () => !!d.signal?.aborted || d.shouldStop()

  // 1. Deletes made while not connected.
  const done: string[] = []
  try {
    for (const id of [...d.getPendingDeletes()]) {
      try {
        await d.api.deleteRecording(id)
        done.push(id)
        stats.deletesSent++
      } catch (e) {
        if (e instanceof CloudError && e.kind === 'gone') done.push(id)
        else if (fatal(e)) throw e
        // anything else: keep it for the next pass
      }
    }
  } finally {
    if (done.length) await d.clearPendingDeletes(done)
  }

  // 2. Server state.
  const list = await d.api.getRecordings()
  const tombs = new Set<string>()
  const onServer = new Set<string>()
  for (const r of Array.isArray(list) ? list : []) {
    if (!r || typeof r.id !== 'string') continue
    if ('deleted' in r && r.deleted) tombs.add(r.id)
    else onServer.add(r.id)
  }

  // 3. Local files; tombstones delete their exact match.
  const local: LocalRec[] = []
  for (const song of d.getLocalSongs()) {
    let entries: RecordingEntry[]
    try { entries = await listRecordings(d.root, song) } catch { continue }
    for (const entry of entries) {
      const id = await recordingId(song.id, entry.fileName)
      if (tombs.has(id)) {
        try { await deleteRecording(d.root, song, entry.fileName); stats.localDeleted++ } catch { /* next pass */ }
      } else local.push({ song, entry, id })
    }
  }

  // 4. Uploads. Tombstoned songs are skipped: the server refuses recordings of deleted songs (409) after the whole
  // file went up; their local files stay on disk.
  if (d.allowUploads === false) return stats
  const pendingDeletes = new Set(d.getPendingDeletes())
  const todo = local
    .filter((r) => !r.song.deletedAt && !onServer.has(r.id) && !pendingDeletes.has(r.id))
    .sort((a, b) => a.entry.date.getTime() - b.entry.date.getTime())
  for (let i = 0; i < todo.length; i++) {
    if (stop()) { stats.stopped = true; break }
    const { song, entry, id } = todo[i]
    const file = await readSongFile(d.root, song, entry.fileName)
    if (!file) continue
    if (stop()) { stats.stopped = true; break } // a take may have started while reading
    d.onProgress?.(i + 1, todo.length)
    const body = { target: 'recording', songId: song.id, id, fileName: entry.fileName, mime: mimeFor(entry.kind), kind: entry.kind, recordedAt: entry.date.toISOString() }
    try {
      await uploadBlob(d.api, file, body, { signal: d.signal })
      stats.uploaded++
    } catch (e) {
      if (stop()) { stats.stopped = true; break }
      if (e instanceof CloudError && e.phase === 'complete') {
        // The server may have stored it anyway: look before ever sending it again.
        let again: Awaited<ReturnType<RecordingsSyncApi['getRecordings']>>
        try { again = await d.api.getRecordings() } catch (v) {
          if (fatal(v)) throw v
          stats.failed++ // unknown outcome: next pass's list decides; go on with the next file
          continue
        }
        if (again.some((r) => r.id === id && !('deleted' in r && r.deleted))) stats.uploaded++
        else stats.pending++
        continue
      }
      if (fatal(e)) throw e
      if (e instanceof CloudError && e.kind === 'rate') { stats.rateLimited = true; break }
      if (e instanceof CloudError && (e.kind === 'conflict' || e.kind === 'gone')) { stats.pending++; continue }
      stats.failed++
    }
  }
  return stats
}
