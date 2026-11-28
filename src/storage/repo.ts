import { parseLibrary, serializeLibrary } from '../domain/library'
import { formatStamp, parseRecordingFileName } from '../domain/time'
import type { Library, RecordingKind, Song, Track } from '../domain/types'
import type { FsDir } from './fsDir'

const LIBRARY_FILE = 'mymusic.json'
const RECORDINGS = 'recordings'

export async function loadLibrary(root: FsDir): Promise<ReturnType<typeof parseLibrary>> {
  const file = await root.readFile(LIBRARY_FILE)
  return parseLibrary(file ? await file.text() : null)
}

export async function saveLibrary(root: FsDir, lib: Library): Promise<void> {
  await root.writeFile(LIBRARY_FILE, serializeLibrary(lib))
}

export async function backupBrokenLibrary(root: FsDir, now: Date): Promise<string> {
  const file = await root.readFile(LIBRARY_FILE)
  if (!file) throw new Error('mymusic.json bulunamadı.')
  const name = `mymusic.broken-${formatStamp(now)}.json`
  await root.writeFile(name, file)
  return name
}

export async function songDir(root: FsDir, song: Song): Promise<FsDir> {
  const rec = (await root.dir(RECORDINGS, { create: true }))!
  return (await rec.dir(song.folderName, { create: true }))!
}

async function existingSongDir(root: FsDir, song: Song): Promise<FsDir | null> {
  const rec = await root.dir(RECORDINGS)
  return rec ? rec.dir(song.folderName) : null
}

export interface RecordingEntry { fileName: string; kind: RecordingKind; date: Date }

export async function listRecordings(root: FsDir, song: Song): Promise<RecordingEntry[]> {
  const dir = await existingSongDir(root, song)
  if (!dir) return []
  const out: RecordingEntry[] = []
  for (const e of await dir.list()) {
    if (e.kind !== 'file') continue
    const p = parseRecordingFileName(e.name)
    if (p) out.push({ fileName: e.name, ...p })
  }
  return out.sort((a, b) => b.date.getTime() - a.date.getTime())
}

/** Deletes exactly this recording (case-sensitive name, recording names only). A missing file is not an error. */
export async function deleteRecording(root: FsDir, song: Song, fileName: string): Promise<void> {
  if (!parseRecordingFileName(fileName)) return
  const dir = await existingSongDir(root, song)
  if (!dir) return
  const hit = (await dir.list()).find((e) => e.kind === 'file' && e.name === fileName)
  if (hit) await dir.remove(hit.name)
}

const isTrackFile = (name: string) => /^track\./.test(name)

export async function importTrack(root: FsDir, song: Song, file: File): Promise<Track> {
  const dir = await songDir(root, song)
  const dot = file.name.lastIndexOf('.')
  const ext = dot >= 0 && dot < file.name.length - 1 ? file.name.slice(dot + 1).toLowerCase() : 'mp3'
  const fileName = `track.${ext}`
  await dir.writeFile(fileName, file)
  for (const e of await dir.list())
    if (e.kind === 'file' && isTrackFile(e.name) && e.name.toLowerCase() !== fileName) await dir.remove(e.name)
  return { fileName, startSec: 0, volume: 0.7 }
}

export async function removeTrack(root: FsDir, song: Song): Promise<void> {
  const dir = await existingSongDir(root, song)
  if (!dir) return
  for (const e of await dir.list()) if (e.kind === 'file' && isTrackFile(e.name)) await dir.remove(e.name)
}

export async function readTrack(root: FsDir, song: Song): Promise<File | null> {
  const dir = await existingSongDir(root, song)
  if (!dir) return null
  if (song.track) return dir.readFile(song.track.fileName)
  const found = (await dir.list()).find((e) => e.kind === 'file' && isTrackFile(e.name))
  return found ? dir.readFile(found.name) : null
}

/** Reads one file of the song folder by exact name (null when the folder or file is missing). */
export async function readSongFile(root: FsDir, song: Song, fileName: string): Promise<File | null> {
  const dir = await existingSongDir(root, song)
  return dir ? dir.readFile(fileName) : null
}

/** Valid names for a synced track: `track.<ext>` (lower-case alnum, max 5). */
export const isSyncTrackName = (name: string) => /^track\.[a-z0-9]{1,5}$/.test(name)

/**
 * Writes a downloaded track under `fileName` (same naming rule as importTrack). Other track.* files are removed only
 * if listed in `replace` (what the caller saw before downloading), so a file imported meanwhile is never removed.
 */
export async function writeTrackFile(root: FsDir, song: Song, fileName: string, data: Blob, opts: { replace: string[] }): Promise<void> {
  if (!isSyncTrackName(fileName)) throw new Error('Invalid track file name')
  const dir = await songDir(root, song)
  await dir.writeFile(fileName, data)
  await removeSongFiles(root, song, opts.replace.filter((n) => isTrackFile(n) && n.toLowerCase() !== fileName))
}

/** Names of the files in the song folder ([] when it doesn't exist). */
export async function listSongFiles(root: FsDir, song: Song): Promise<string[]> {
  const dir = await existingSongDir(root, song)
  return dir ? (await dir.list()).filter((e) => e.kind === 'file').map((e) => e.name) : []
}

/** Removes exactly these files of the song folder; missing ones are fine. */
export async function removeSongFiles(root: FsDir, song: Song, names: string[]): Promise<void> {
  if (!names.length) return
  const dir = await existingSongDir(root, song)
  if (dir) for (const n of names) await dir.remove(n)
}
