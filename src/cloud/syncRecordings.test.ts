import { describe, expect, it } from 'vitest'
import { createSong } from '../domain/library'
import type { Song } from '../domain/types'
import { createMemoryDir } from '../storage/memoryDir'
import { listRecordings, songDir } from '../storage/repo'
import { CloudError } from './api'
import { createFakeCloud } from './fakeCloud.testutil'
import { recordingId } from './hash'
import { syncRecordingsOnce, type RecordingsSyncDeps } from './syncRecordings'

const mk = (id: string, extra: Partial<Song> = {}): Song => ({
  ...createSong({ title: id, artist: 'Band', status: 'learning', bpm: 100, countInBeats: 4 }, new Date('2026-11-01T00:00:00Z'), id),
  ...extra,
})
const V1 = '2026-11-24_21-30-05_video.webm'
const V2 = '2026-11-25_10-00-00_ses.webm'
const V3 = '2026-11-26_10-00-00_video.webm'

function setup(songs: Song[], opts: Partial<RecordingsSyncDeps> = {}) {
  const root = createMemoryDir()
  const cloud = createFakeCloud()
  for (const s of songs) if (!s.deletedAt) cloud.live.add(s.id)
  let pending: string[] = []
  const progress: string[] = []
  const deps: RecordingsSyncDeps = {
    api: cloud.api,
    root,
    getLocalSongs: () => songs,
    getPendingDeletes: () => pending,
    clearPendingDeletes: async (ids) => { pending = pending.filter((x) => !ids.includes(x)) },
    shouldStop: () => false,
    onProgress: (done, total) => progress.push(`${done}/${total}`),
    ...opts,
  }
  return { root, cloud, deps, progress, pending: () => pending, setPending: (p: string[]) => { pending = p } }
}
async function rec(root: ReturnType<typeof createMemoryDir>, song: Song, name: string) {
  await (await songDir(root, song)).writeFile(name, new Blob([`data-${name}`]))
}
const names = async (root: ReturnType<typeof createMemoryDir>, song: Song) => (await listRecordings(root, song)).map((e) => e.fileName).sort()

describe('syncRecordingsOnce', () => {
  it('uploads the recordings the server lacks, one at a time, with the server complete body', async () => {
    const s = mk('s1')
    const h = setup([s])
    await rec(h.root, s, V1)
    await rec(h.root, s, V2)
    await rec(h.root, s, V3)
    const id1 = await recordingId('s1', V1)
    h.cloud.recordings.set(id1, { id: id1, songId: 's1', kind: 'video', recordedAt: '', fileName: V1, size: 1, durationSec: null, status: 'ready', songTitle: '', songArtist: '', shared: false })
    let inFlight = 0
    let maxInFlight = 0
    h.cloud.onPart = async () => { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); await Promise.resolve(); inFlight-- }
    const stats = await syncRecordingsOnce(h.deps)
    expect(stats.uploaded).toBe(2)
    expect(maxInFlight).toBe(1)
    const id2 = await recordingId('s1', V2)
    expect(h.cloud.recordings.get(id2)).toMatchObject({ songId: 's1', kind: 'ses', fileName: V2, recordedAt: new Date(2026, 10, 25, 10, 0, 0).toISOString() })
    expect(h.cloud.log.filter((l) => l.startsWith('complete:'))).toHaveLength(2)
    expect(h.progress).toEqual(['1/2', '2/2'])
    // A second pass has nothing to do.
    h.cloud.log.length = 0
    await syncRecordingsOnce(h.deps)
    expect(h.cloud.log).toEqual(['list'])
  })

  it('uploads nothing while busy, and stops further uploads when a take starts mid-pass', async () => {
    const s = mk('s1')
    let busy = true
    const h = setup([s], { shouldStop: () => busy })
    await rec(h.root, s, V1)
    await rec(h.root, s, V2)
    expect((await syncRecordingsOnce(h.deps)).stopped).toBe(true)
    expect(h.cloud.log.filter((l) => l === 'create')).toEqual([])

    busy = false
    h.cloud.onPart = () => { busy = true } // the take starts while the first file is going up
    const stats = await syncRecordingsOnce(h.deps)
    expect(stats).toMatchObject({ uploaded: 1, stopped: true })
    expect(h.cloud.log.filter((l) => l === 'create')).toHaveLength(1)
  })

  it('an abort signal (take started) cancels the running upload and keeps the file', async () => {
    const s = mk('s1')
    const ac = new AbortController()
    const h = setup([s], { signal: ac.signal, shouldStop: () => ac.signal.aborted })
    await rec(h.root, s, V1)
    h.cloud.onPart = () => { ac.abort() }
    const stats = await syncRecordingsOnce(h.deps)
    expect(stats).toMatchObject({ uploaded: 0, stopped: true, failed: 0 })
    expect(h.cloud.recordings.size).toBe(0)
    expect(await names(h.root, s)).toEqual([V1])
  })

  it('a server tombstone deletes the matching local file and it is never uploaded', async () => {
    const s = mk('s1')
    const h = setup([s])
    await rec(h.root, s, V1)
    await rec(h.root, s, V2)
    h.cloud.tombstones.add(await recordingId('s1', V1))
    h.cloud.tombstones.add(await recordingId('other', V2)) // same file name, other song: not ours
    const stats = await syncRecordingsOnce(h.deps)
    expect(stats.localDeleted).toBe(1)
    expect(await names(h.root, s)).toEqual([V2])
    expect(h.cloud.recordings.has(await recordingId('s1', V1))).toBe(false)
    expect(h.cloud.recordings.has(await recordingId('s1', V2))).toBe(true)
  })

  it('sends pending deletes first; 204 and 404 clear them, network errors keep them', async () => {
    const s = mk('s1')
    const h = setup([s])
    h.setPending(['aaa', 'bbb', 'ccc'])
    h.cloud.failDelete = (id) =>
      id === 'bbb' ? new CloudError('gone', 'Not found', { status: 404 }) : id === 'ccc' ? new CloudError('server', 'Oops', { status: 500 }) : undefined
    await syncRecordingsOnce(h.deps)
    expect(h.pending()).toEqual(['ccc'])
    expect(h.cloud.log.indexOf('delete:aaa')).toBeLessThan(h.cloud.log.indexOf('list'))

    h.cloud.failDelete = () => new CloudError('offline', 'Network error')
    await expect(syncRecordingsOnce(h.deps)).rejects.toMatchObject({ kind: 'offline' })
    expect(h.pending()).toEqual(['ccc'])
    h.cloud.failDelete = undefined
    await syncRecordingsOnce(h.deps)
    expect(h.pending()).toEqual([])
    expect(h.cloud.tombstones.has('ccc')).toBe(true)
  })

  it('complete timeout: verifies via the list and does not upload again', async () => {
    const s = mk('s1')
    const h = setup([s])
    await rec(h.root, s, V1)
    h.cloud.completeTimesOut = () => true
    const stats = await syncRecordingsOnce(h.deps)
    expect(stats.uploaded).toBe(1)
    h.cloud.completeTimesOut = undefined
    await syncRecordingsOnce(h.deps)
    expect(h.cloud.log.filter((l) => l === 'create')).toHaveLength(1)
    expect(await names(h.root, s)).toEqual([V1])
  })

  it('upload failures (409 unknown song, 410, 500, offline) never touch the local file', async () => {
    const s = mk('s1')
    const h = setup([s])
    h.cloud.live.clear()
    await rec(h.root, s, V1)
    expect(await syncRecordingsOnce(h.deps)).toMatchObject({ uploaded: 0, failed: 0, pending: 1 })
    h.cloud.live.add('s1')
    h.cloud.api.completeUpload = async () => { throw new CloudError('server', 'Oops', { status: 500 }) }
    expect(await syncRecordingsOnce(h.deps)).toMatchObject({ uploaded: 0, failed: 1 })
    h.cloud.api.completeUpload = async () => { throw new CloudError('offline', 'Network error') }
    await expect(syncRecordingsOnce(h.deps)).rejects.toMatchObject({ kind: 'offline' })
    h.cloud.api.completeUpload = async () => { throw new CloudError('gone', 'Recording was deleted', { status: 410 }) }
    await syncRecordingsOnce(h.deps)
    expect(await names(h.root, s)).toEqual([V1])
  })

  it('rate limit stops uploads for this pass', async () => {
    const s = mk('s1')
    const h = setup([s])
    await rec(h.root, s, V1)
    await rec(h.root, s, V2)
    h.cloud.failCreate = () => new CloudError('rate', 'Too many', { status: 429, retryAfter: 30 })
    const stats = await syncRecordingsOnce(h.deps)
    expect(stats).toMatchObject({ uploaded: 0, rateLimited: true })
    expect(h.cloud.log.filter((l) => l === 'create')).toHaveLength(1)
    expect(await names(h.root, s)).toEqual([V1, V2].sort())
  })

  it('allowUploads: false still sends deletes and applies tombstones', async () => {
    const s = mk('s1')
    const h = setup([s], { allowUploads: false })
    await rec(h.root, s, V1)
    h.setPending(['aaa'])
    await syncRecordingsOnce(h.deps)
    expect(h.pending()).toEqual([])
    expect(h.cloud.log.filter((l) => l === 'create')).toEqual([])
  })

  it('tombstoned songs: tombstones still delete their local files; no futile uploads (server answers 409)', async () => {
    const gone = mk('g', { deletedAt: '2026-11-02T00:00:00Z' })
    const h = setup([gone])
    await rec(h.root, gone, V1)
    await rec(h.root, gone, V2)
    h.cloud.tombstones.add(await recordingId('g', V1))
    await syncRecordingsOnce(h.deps)
    expect(await names(h.root, gone)).toEqual([V2])
    expect(h.cloud.log.filter((l) => l === 'create')).toEqual([])
  })
  it('re-checks stop after reading the file, before uploading', async () => {
    const s = mk('s1')
    let calls = 0
    const h = setup([s], { shouldStop: () => ++calls > 1 })
    await rec(h.root, s, V1)
    expect((await syncRecordingsOnce(h.deps)).stopped).toBe(true)
    expect(h.cloud.log.filter((l) => l === 'create')).toEqual([])
  })

  it('a failing verify list after a complete timeout counts as failed and the pass goes on', async () => {
    const s = mk('s1')
    const h = setup([s])
    await rec(h.root, s, V1)
    await rec(h.root, s, V2)
    h.cloud.completeTimesOut = (b) => b.fileName === V1
    const list = h.cloud.api.getRecordings
    let n = 0
    h.cloud.api.getRecordings = async () => { if (++n === 2) throw new CloudError('server', 'Oops', { status: 500 }); return list() }
    const stats = await syncRecordingsOnce(h.deps)
    expect(stats).toMatchObject({ failed: 1, uploaded: 1 })
    expect(h.cloud.recordings.has(await recordingId('s1', V2))).toBe(true)
    expect(await names(h.root, s)).toEqual([V1, V2].sort())
  })
})
