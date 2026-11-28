// In-memory stand-in for the server's file, upload and recording routes (tests only).
import type { RecordingInfo, RecordingListItem } from '../../shared/api'
import { CloudError } from './api'
import { sha256Hex } from './hash'
import type { FilesSyncApi } from './syncFiles'
import type { RecordingsSyncApi } from './syncRecordings'

export interface FakeCloud {
  api: FilesSyncApi & RecordingsSyncApi
  files: Map<string, { blob: Blob; hash: string; fileName: string; mime: string }>
  recordings: Map<string, RecordingInfo>
  tombstones: Set<string>
  /** Song ids the server knows as live (recording/track/cover uploads for others get 409). */
  live: Set<string>
  /** 'create', 'part:<id>:<n>', 'complete:<target>:<songId|id>', 'head:..', 'get:..', 'delete:<id>' */
  log: string[]
  /** Hooks: return an error to throw it instead. */
  failCreate?: () => CloudError | undefined
  failDelete?: (id: string) => CloudError | undefined
  /** Runs before a part is stored; may throw. */
  onPart?: (n: number) => Promise<void> | void
  /** Store the item, then throw a timed-out complete (phase 'complete'). */
  completeTimesOut?: (body: Record<string, unknown>) => boolean
  /** The served hash header differs from the content (simulates a stale/mismatched server copy). */
  headerHash?: (key: string) => string | undefined
}

const key = (songId: string, kind: string) => `${songId}/${kind}`

export function createFakeCloud(): FakeCloud {
  const uploads = new Map<string, Blob[]>()
  let nextUpload = 0
  const fc: FakeCloud = {
    files: new Map(),
    recordings: new Map(),
    tombstones: new Set(),
    live: new Set(),
    log: [],
    api: {
      async headFile(songId, kind) {
        fc.log.push(`head:${key(songId, kind)}`)
        const f = fc.files.get(key(songId, kind))
        if (!f) return null
        return fc.headerHash?.(key(songId, kind)) ?? f.hash
      },
      async getFile(songId, kind) {
        fc.log.push(`get:${key(songId, kind)}`)
        const f = fc.files.get(key(songId, kind))
        if (!f) throw new CloudError('gone', 'No file', { status: 404 })
        return { blob: f.blob, hash: fc.headerHash?.(key(songId, kind)) ?? f.hash }
      },
      async createUpload() {
        fc.log.push('create')
        const err = fc.failCreate?.()
        if (err) throw err
        const uploadId = `u${nextUpload++}`
        uploads.set(uploadId, [])
        return { uploadId }
      },
      async putPart(uploadId, n, body, o = {}) {
        await fc.onPart?.(n)
        if (o.signal?.aborted) throw new CloudError('client', 'Aborted')
        fc.log.push(`part:${uploadId}:${n}`)
        uploads.get(uploadId)![n] = body
        return { size: body.size }
      },
      async completeUpload(uploadId, body) {
        const parts = uploads.get(uploadId)
        if (!parts) throw new CloudError('conflict', 'Upload is gone', { status: 409 })
        uploads.delete(uploadId)
        const blob = new Blob(parts)
        const target = body.target as string
        const songId = body.songId as string
        fc.log.push(`complete:${target}:${target === 'recording' ? (body.id as string) : songId}`)
        let out: Record<string, unknown>
        if (target === 'recording') {
          const id = body.id as string
          if (fc.tombstones.has(id)) throw new CloudError('gone', 'Recording was deleted', { status: 410 })
          if (!fc.live.has(songId)) throw new CloudError('conflict', 'Unknown or deleted song', { status: 409 })
          fc.recordings.set(id, {
            id, songId, kind: body.kind as 'video' | 'ses', recordedAt: body.recordedAt as string, fileName: body.fileName as string,
            size: blob.size, durationSec: null, status: 'processing', songTitle: '', songArtist: '', shared: false,
          })
          out = { id, status: 'processing' }
        } else {
          if (!fc.live.has(songId)) throw new CloudError('conflict', 'Unknown or deleted song', { status: 409 })
          const hash = await sha256Hex(blob)
          fc.files.set(key(songId, target), { blob, hash, fileName: body.fileName as string, mime: body.mime as string })
          out = { hash, size: blob.size }
        }
        if (fc.completeTimesOut?.(body)) throw new CloudError('offline', 'Request timed out', { phase: 'complete' })
        return out
      },
      async abortUpload(uploadId) {
        uploads.delete(uploadId)
        return undefined
      },
      async getRecordings(): Promise<RecordingListItem[]> {
        fc.log.push('list')
        return [...fc.recordings.values(), ...[...fc.tombstones].map((id) => ({ id, deleted: true as const }))]
      },
      async deleteRecording(id) {
        fc.log.push(`delete:${id}`)
        const err = fc.failDelete?.(id)
        if (err) throw err
        fc.recordings.delete(id)
        fc.tombstones.add(id)
        return undefined
      },
    },
  }
  return fc
}
