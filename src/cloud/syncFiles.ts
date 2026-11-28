import type { Cover, Song, Track } from '../domain/types'
import { writeCover } from '../storage/cover'
import type { FsDir } from '../storage/fsDir'
import { isSyncTrackName, listSongFiles, readSongFile, removeSongFiles, writeTrackFile } from '../storage/repo'
import { CloudError, type CloudApi } from './api'
import { uploadBlob } from './chunkedUpload'
import { sha256Hex } from './hash'

export type UploadApi = Pick<CloudApi, 'createUpload' | 'putPart' | 'completeUpload' | 'abortUpload'>
export type FilesSyncApi = UploadApi & Pick<CloudApi, 'headFile' | 'getFile'>

export interface FilesSyncDeps {
  api: FilesSyncApi
  root: FsDir
  /** All local songs as of now (merged record = authority). */
  getLocalSongs(): Song[]
  /** Used with { auto: true } only (hash backfill). */
  patchSong(id: string, patch: Partial<Song>, opts: { auto: true }): Promise<void>
  /** True while a take runs: no transfer starts. */
  shouldStop(): boolean
  signal?: AbortSignal
  /** `${songId}/${kind}/${hash}` known to be on the server this session (skips the HEAD probe). */
  confirmed?: Set<string>
  /** Hash cache keyed by file identity (folder/name/size/mtime), so unchanged files aren't re-hashed every pass. */
  hashCache?: Map<string, string>
  onProgress?(done: number, total: number): void
  /** Backfill hashing limit (default MAX_BACKFILL_BYTES). */
  maxBackfillBytes?: number
}

export interface FilesSyncStats {
  uploaded: number
  downloaded: number
  /** Not possible yet (server lacks the file / hash differs / song unknown): retried next pass, not an error. */
  pending: number
  failed: number
  stopped: boolean
  rateLimited: boolean
  /** Things the user should know (status lastError), e.g. a file too big to hash. */
  notes: string[]
}

/** Files above this are never hashed for a backfill (whole-file hashing in memory). */
export const MAX_BACKFILL_BYTES = 200 * 1024 * 1024
export const BIG_FILE_NOTE = 'Çok büyük bir dosya eşitlenmedi (200 MB üstü).'

type Kind = 'track' | 'cover'

const TRACK_MIME: Record<string, string> = { mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', opus: 'audio/opus', webm: 'audio/webm' }
const COVER_MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' }
const extOf = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase()
const isSyncCoverName = (name: string) => /^cover\.[a-z0-9]{1,5}$/.test(name)
const KIND_FILE: Record<Kind, RegExp> = { track: /^track\./, cover: /^cover\./i }
const kindFiles = async (root: FsDir, song: Song, kind: Kind) => (await listSongFiles(root, song)).filter((n) => KIND_FILE[kind].test(n)).sort()

function mimeFor(kind: Kind, file: File): string | null {
  const ext = extOf(file.name)
  if (kind === 'cover') return COVER_MIME[ext] ?? (/^image\/(png|jpeg|webp|gif)$/.test(file.type) ? file.type : null)
  return TRACK_MIME[ext] ?? (file.type.startsWith('audio/') ? file.type : 'audio/mpeg')
}

/** The synced file reference of a song, or null when there is nothing to sync (url-only/removed cover, no track). */
function refOf(song: Song, kind: Kind): { fileName: string; hash?: string } | null {
  if (kind === 'track') return song.track?.fileName ? song.track : null
  const c = song.cover
  return c && c.source !== 'none' && c.fileName ? { fileName: c.fileName, hash: c.hash } : null
}

const fatal = (e: unknown) => e instanceof CloudError && (e.kind === 'offline' || e.kind === 'auth')

/**
 * One tracks/covers pass. Per live song and kind, with the merged record's hash as the authority (decision 4):
 * - local file == record hash: make sure the server has it (HEAD probe, once per session) and upload if not;
 * - local missing / different: download when the server's copy has the record hash, else retry later.
 * A missing hash is adopted from the server's copy, or (server has none) backfilled from the local file, by automatic patch.
 */
export async function syncFilesOnce(d: FilesSyncDeps): Promise<FilesSyncStats> {
  const stats: FilesSyncStats = { uploaded: 0, downloaded: 0, pending: 0, failed: 0, stopped: false, rateLimited: false, notes: [] }
  const confirmed = d.confirmed ?? new Set<string>()
  const cache = d.hashCache ?? new Map<string, string>()
  const stop = () => d.signal?.aborted || d.shouldStop()

  const hashOf = async (song: Song, file: File): Promise<string> => {
    const k = `${song.folderName}/${file.name}|${file.size}|${file.lastModified}`
    let h = cache.get(k)
    if (!h) { h = await sha256Hex(file); cache.set(k, h) }
    return h
  }
  const current = (id: string) => d.getLocalSongs().find((s) => s.id === id && !s.deletedAt)

  const work = d.getLocalSongs().filter((s) => !s.deletedAt).flatMap((s) => (['track', 'cover'] as Kind[]).filter((k) => refOf(s, k)).map((k) => [s.id, k] as const))
  let done = 0
  for (const [id, kind] of work) {
    d.onProgress?.(++done, work.length)
    if (stop()) { stats.stopped = true; break }
    let song = current(id)
    let ref = song && refOf(song, kind)
    if (!song || !ref) continue
    const local = await readSongFile(d.root, song, ref.fileName)

    try {
      if (!ref.hash) {
        // A record from before hashes existed. The server's copy wins when it has one (adopted into the record);
        // only when the server has no file is this computer's file the only candidate and gets hashed.
        const server = await d.api.headFile(id, kind)
        let adopt: string
        if (server) adopt = server
        else if (server === '' || !local) { stats.pending++; continue }
        else if (local.size > (d.maxBackfillBytes ?? MAX_BACKFILL_BYTES)) { stats.notes.push(BIG_FILE_NOTE); continue }
        else adopt = await hashOf(song, local)
        await backfill(d, song, kind, adopt)
        song = current(id)
        ref = song && refOf(song, kind)
        if (!song || !ref || ref.hash !== adopt) continue
        if (server) confirmed.add(`${id}/${kind}/${adopt}`)
      }
      const want = ref.hash!
      const tag = `${id}/${kind}/${want}`
      const localHash = local ? await hashOf(song, local) : null

      if (local && localHash === want) {
        if (confirmed.has(tag)) continue
        const serverHash = await d.api.headFile(id, kind)
        if (serverHash === want) { confirmed.add(tag); continue }
        if (stats.rateLimited) continue
        const mime = mimeFor(kind, local)
        if (!mime) { stats.pending++; continue }
        if (stop()) { stats.stopped = true; break }
        const res = await uploadBlob(d.api, local, { target: kind, songId: id, fileName: ref.fileName, mime }, { signal: d.signal })
        if (res.hash === want) confirmed.add(tag)
        stats.uploaded++
      } else {
        const okName = kind === 'track' ? isSyncTrackName(ref.fileName) : isSyncCoverName(ref.fileName)
        if (!okName) { stats.pending++; continue }
        if (stop()) { stats.stopped = true; break }
        // Every track.* / cover.* in the folder now: a write only replaces these, and any change meanwhile
        // (an import of another extension, a new user cover) cancels the write.
        const before = await kindFiles(d.root, song, kind)
        let got: { blob: Blob; hash: string | null }
        try { got = await d.api.getFile(id, kind, { signal: d.signal }) } catch (e) {
          if (e instanceof CloudError && e.kind === 'gone') { stats.pending++; continue }
          throw e
        }
        if (got.hash !== want || (await sha256Hex(got.blob)) !== want) { stats.pending++; continue }
        const after = await kindFiles(d.root, song, kind)
        if (after.join('/') !== before.join('/')) { stats.pending++; continue }
        // The local file must still be the one we compared (an import may be between its write and its patch).
        const again = await readSongFile(d.root, song, ref.fileName)
        if ((again ? await hashOf(song, again) : null) !== localHash) { stats.pending++; continue }
        // Last check right before writing (no await in between): the record still asks for this, song not deleted.
        const now = current(id)
        const nowRef = now && refOf(now, kind)
        if (!now || !nowRef || nowRef.hash !== want || nowRef.fileName !== ref.fileName) continue
        if (kind === 'track') await writeTrackFile(d.root, now, ref.fileName, got.blob, { replace: before })
        else {
          await writeCover(d.root, now, got.blob, extOf(ref.fileName), { cleanup: false })
          await removeSongFiles(d.root, now, before.filter((n) => n.toLowerCase() !== ref!.fileName.toLowerCase()))
        }
        confirmed.add(tag)
        stats.downloaded++
      }
    } catch (e) {
      if (d.signal?.aborted || (e instanceof CloudError && e.kind === 'client' && stop())) { stats.stopped = true; break }
      if (fatal(e)) throw e
      if (e instanceof CloudError && e.kind === 'rate') { stats.rateLimited = true; continue }
      if (e instanceof CloudError && (e.kind === 'conflict' || e.kind === 'gone')) { stats.pending++; continue }
      stats.failed++
    }
  }
  return stats
}

async function backfill(d: FilesSyncDeps, song: Song, kind: Kind, hash: string): Promise<void> {
  if (kind === 'track') {
    const track: Track = { ...song.track!, hash }
    await d.patchSong(song.id, { track }, { auto: true })
  } else {
    const cover: Cover = { ...song.cover!, hash }
    await d.patchSong(song.id, { cover }, { auto: true })
  }
}
