export type SongStatus = 'known' | 'learning'
export interface Track { fileName: string; startSec: number; volume: number; /** sha256 of the file (synced; filled by a background job). */ hash?: string }
/** `source: 'none'` = removed on purpose: no file/url, and the backfill leaves it alone. */
export interface Cover { source: 'itunes' | 'user' | 'none'; fileName?: string; url?: string; hash?: string }
export interface Song {
  id: string; title: string; artist: string; status: SongStatus
  bpm: number; countInBeats: number; track?: Track
  cover?: Cover; chords?: string
  /** Own light color '#rrggbb'; absent = use the global choice. */
  lightColor?: string
  folderName: string // fixed at creation, never renamed
  createdAt: string; updatedAt: string // ISO
  /** Set when deleted (ISO): the song stays as a tombstone so the delete syncs; never shown. */
  deletedAt?: string
  [extra: string]: unknown
}
export interface Library {
  version: 1
  settings: { latencyCompensationMs: number | null; [extra: string]: unknown }
  songs: Song[]
  /** Recording ids to delete on the server (deleted while not connected). */
  pendingDeletes?: string[]
  [extra: string]: unknown
}
export type RecordingKind = 'video' | 'ses'
