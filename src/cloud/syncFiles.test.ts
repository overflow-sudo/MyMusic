import { describe, expect, it } from 'vitest'
import { createSong } from '../domain/library'
import type { Song } from '../domain/types'
import { createMemoryDir } from '../storage/memoryDir'
import { songDir } from '../storage/repo'
import { CloudError } from './api'
import { createFakeCloud } from './fakeCloud.testutil'
import { sha256Hex } from './hash'
import { syncFilesOnce, type FilesSyncDeps } from './syncFiles'

const mk = (id: string, extra: Partial<Song> = {}): Song => ({
  ...createSong({ title: id, artist: 'Band', status: 'learning', bpm: 100, countInBeats: 4 }, new Date('2026-11-01T00:00:00Z'), id),
  ...extra,
})

function setup(songs: Song[], opts: Partial<FilesSyncDeps> = {}) {
  const root = createMemoryDir()
  const cloud = createFakeCloud()
  for (const s of songs) if (!s.deletedAt) cloud.live.add(s.id)
  let local = songs
  const patches: { id: string; patch: Partial<Song>; auto?: boolean }[] = []
  const deps: FilesSyncDeps = {
    api: cloud.api,
    root,
    getLocalSongs: () => local,
    patchSong: async (id, patch, o) => {
      patches.push({ id, patch, auto: o?.auto })
      local = local.map((s) => (s.id === id ? { ...s, ...patch } : s))
    },
    shouldStop: () => false,
    ...opts,
  }
  return { root, cloud, deps, patches, songs: () => local }
}

async function put(root: ReturnType<typeof createMemoryDir>, song: Song, name: string, content: string) {
  await (await songDir(root, song)).writeFile(name, new Blob([content]))
}
async function read(root: ReturnType<typeof createMemoryDir>, song: Song, name: string) {
  const f = await (await songDir(root, song)).readFile(name)
  return f ? await f.text() : null
}

describe('syncFilesOnce', () => {
  it('downloads a missing local track and writes it under the record file name', async () => {
    const hash = await sha256Hex('server-mp3')
    const song = mk('s1', { track: { fileName: 'track.mp3', startSec: 0, volume: 0.7, hash } })
    const h = setup([song])
    h.cloud.files.set('s1/track', { blob: new Blob(['server-mp3']), hash, fileName: 'track.mp3', mime: 'audio/mpeg' })
    const stats = await syncFilesOnce(h.deps)
    expect(await read(h.root, song, 'track.mp3')).toBe('server-mp3')
    expect(stats.downloaded).toBe(1)
    expect(h.cloud.log.filter((l) => l === 'create')).toHaveLength(0)
  })

  it('replaces a local track whose hash differs from the record (server copy matches)', async () => {
    const hash = await sha256Hex('new')
    const song = mk('s1', { track: { fileName: 'track.mp3', startSec: 0, volume: 0.7, hash } })
    const h = setup([song])
    await put(h.root, song, 'track.mp3', 'old')
    await put(h.root, song, 'track.wav', 'stray')
    h.cloud.files.set('s1/track', { blob: new Blob(['new']), hash, fileName: 'track.mp3', mime: 'audio/mpeg' })
    await syncFilesOnce(h.deps)
    expect(await read(h.root, song, 'track.mp3')).toBe('new')
    expect(await read(h.root, song, 'track.wav')).toBeNull()
  })

  it('uploads a local track the server lacks (local file = record hash)', async () => {
    const hash = await sha256Hex('local-mp3')
    const song = mk('s1', { track: { fileName: 'track.mp3', startSec: 0, volume: 0.7, hash } })
    const h = setup([song])
    await put(h.root, song, 'track.mp3', 'local-mp3')
    const stats = await syncFilesOnce(h.deps)
    expect(stats.uploaded).toBe(1)
    const f = h.cloud.files.get('s1/track')!
    expect(f).toMatchObject({ hash, fileName: 'track.mp3', mime: 'audio/mpeg' })
  })

  it('uploads when the server copy is older (different hash), and a user cover too', async () => {
    const hash = await sha256Hex('v2')
    const chash = await sha256Hex('png')
    const song = mk('s1', { track: { fileName: 'track.mp3', startSec: 0, volume: 0.7, hash }, cover: { source: 'user', fileName: 'cover.png', hash: chash } })
    const h = setup([song])
    await put(h.root, song, 'track.mp3', 'v2')
    await put(h.root, song, 'cover.png', 'png')
    h.cloud.files.set('s1/track', { blob: new Blob(['v1']), hash: await sha256Hex('v1'), fileName: 'track.mp3', mime: 'audio/mpeg' })
    await syncFilesOnce(h.deps)
    expect(h.cloud.files.get('s1/track')!.hash).toBe(hash)
    expect(h.cloud.files.get('s1/cover')).toMatchObject({ hash: chash, mime: 'image/png' })
  })

  it('does not probe again in the same session once a file is known to be on the server', async () => {
    const hash = await sha256Hex('x')
    const song = mk('s1', { track: { fileName: 'track.mp3', startSec: 0, volume: 0.7, hash } })
    const h = setup([song], { confirmed: new Set() })
    await put(h.root, song, 'track.mp3', 'x')
    await syncFilesOnce(h.deps)
    const n = h.cloud.log.length
    await syncFilesOnce(h.deps)
    expect(h.cloud.log.length).toBe(n)
  })

  it('server lacks the file (404) or its hash differs from the record → retry later, no error', async () => {
    const hash = await sha256Hex('wanted')
    const a = mk('a', { track: { fileName: 'track.mp3', startSec: 0, volume: 0.7, hash } })
    const b = mk('b', { track: { fileName: 'track.mp3', startSec: 0, volume: 0.7, hash } })
    const h = setup([a, b])
    h.cloud.files.set('b/track', { blob: new Blob(['other']), hash: await sha256Hex('other'), fileName: 'track.mp3', mime: 'audio/mpeg' })
    const stats = await syncFilesOnce(h.deps)
    expect(stats).toMatchObject({ downloaded: 0, uploaded: 0, failed: 0, pending: 2 })
    expect(await read(h.root, a, 'track.mp3')).toBeNull()
    expect(await read(h.root, b, 'track.mp3')).toBeNull()
  })

  it('a served hash header that lies is caught by hashing the download', async () => {
    const hash = await sha256Hex('wanted')
    const song = mk('s1', { track: { fileName: 'track.mp3', startSec: 0, volume: 0.7, hash } })
    const h = setup([song])
    h.cloud.files.set('s1/track', { blob: new Blob(['corrupt']), hash, fileName: 'track.mp3', mime: 'audio/mpeg' })
    const stats = await syncFilesOnce(h.deps)
    expect(stats.pending).toBe(1)
    expect(await read(h.root, song, 'track.mp3')).toBeNull()
  })

  it('backfills a missing hash with an automatic patch, then uploads', async () => {
    const song = mk('s1', { track: { fileName: 'track.mp3', startSec: 3, volume: 0.5 }, cover: { source: 'itunes', fileName: 'cover.jpg' } })
    const h = setup([song])
    await put(h.root, song, 'track.mp3', 'mp3')
    await put(h.root, song, 'cover.jpg', 'jpg')
    await syncFilesOnce(h.deps)
    expect(h.patches).toEqual([
      { id: 's1', patch: { track: { fileName: 'track.mp3', startSec: 3, volume: 0.5, hash: await sha256Hex('mp3') } }, auto: true },
      { id: 's1', patch: { cover: { source: 'itunes', fileName: 'cover.jpg', hash: await sha256Hex('jpg') } }, auto: true },
    ])
    expect(h.cloud.files.get('s1/track')?.hash).toBe(await sha256Hex('mp3'))
    expect(h.cloud.files.get('s1/cover')?.mime).toBe('image/jpeg')
  })

  it('skips url-only and removed covers, tombstoned songs, and songs without files', async () => {
    const h = setup([
      mk('a', { cover: { source: 'itunes', url: 'https://example.test/a.jpg' } }),
      mk('b', { cover: { source: 'none' } }),
      mk('c', { deletedAt: '2026-11-02T00:00:00Z', track: { fileName: 'track.mp3', startSec: 0, volume: 0.7, hash: 'abc' } }),
      mk('d'),
    ])
    const stats = await syncFilesOnce(h.deps)
    expect(h.cloud.log).toEqual([])
    expect(stats).toMatchObject({ downloaded: 0, uploaded: 0, pending: 0, failed: 0 })
  })

  it('never transfers while busy', async () => {
    const hash = await sha256Hex('local')
    const song = mk('s1', { track: { fileName: 'track.mp3', startSec: 0, volume: 0.7, hash } })
    const h = setup([song], { shouldStop: () => true })
    await put(h.root, song, 'track.mp3', 'local')
    const stats = await syncFilesOnce(h.deps)
    expect(stats.stopped).toBe(true)
    expect(h.cloud.log.filter((l) => l === 'create' || l.startsWith('get:'))).toEqual([])
  })

  it('409 (song unknown on the server) is retried later; rate stops further uploads; offline ends the pass', async () => {
    const hash = await sha256Hex('a')
    const a = mk('a', { track: { fileName: 'track.mp3', startSec: 0, volume: 0.7, hash } })
    const b = mk('b', { track: { fileName: 'track.mp3', startSec: 0, volume: 0.7, hash } })
    const h = setup([a, b])
    h.cloud.live.delete('a')
    await put(h.root, a, 'track.mp3', 'a')
    await put(h.root, b, 'track.mp3', 'a')
    let creates = 0
    h.cloud.failCreate = () => (++creates === 2 ? new CloudError('rate', 'Too many', { status: 429, retryAfter: 5 }) : undefined)
    const stats = await syncFilesOnce(h.deps)
    expect(stats).toMatchObject({ uploaded: 0, pending: 1, failed: 0, rateLimited: true })
    expect(await read(h.root, a, 'track.mp3')).toBe('a')

    h.cloud.failCreate = () => new CloudError('offline', 'Network error')
    await expect(syncFilesOnce(h.deps)).rejects.toMatchObject({ kind: 'offline' })
  })

  it('does not write a download when the record changed meanwhile', async () => {
    const hash = await sha256Hex('server')
    const song = mk('s1', { track: { fileName: 'track.mp3', startSec: 0, volume: 0.7, hash } })
    const h = setup([song])
    h.cloud.files.set('s1/track', { blob: new Blob(['server']), hash, fileName: 'track.mp3', mime: 'audio/mpeg' })
    const getFile = h.cloud.api.getFile
    let local = h.songs()
    h.deps.getLocalSongs = () => local
    h.cloud.api.getFile = async (...a) => {
      const r = await getFile(...a)
      local = [{ ...song, track: { fileName: 'track.mp3', startSec: 0, volume: 0.7, hash: 'user-imported' } }]
      return r
    }
    await syncFilesOnce(h.deps)
    expect(await read(h.root, song, 'track.mp3')).toBeNull()
  })
  it('does not overwrite a local file that changed while downloading (import between write and patch)', async () => {
    const hash = await sha256Hex('server')
    const song = mk('s1', { track: { fileName: 'track.mp3', startSec: 0, volume: 0.7, hash } })
    const h = setup([song])
    await put(h.root, song, 'track.mp3', 'old')
    h.cloud.files.set('s1/track', { blob: new Blob(['server']), hash, fileName: 'track.mp3', mime: 'audio/mpeg' })
    const getFile = h.cloud.api.getFile
    h.cloud.api.getFile = async (...a) => {
      const r = await getFile(...a)
      await put(h.root, song, 'track.mp3', 'just-imported')
      return r
    }
    await syncFilesOnce(h.deps)
    expect(await read(h.root, song, 'track.mp3')).toBe('just-imported')
  })
})
