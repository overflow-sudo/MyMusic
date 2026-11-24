export type SongStatus = 'known' | 'learning'
export interface Track { fileName: string; startSec: number; volume: number }
export interface Song {
  id: string; title: string; artist: string; status: SongStatus
  bpm: number; countInBeats: number; track?: Track
  folderName: string // fixed at creation, never renamed
  createdAt: string; updatedAt: string // ISO
  [extra: string]: unknown
}
export interface Library {
  version: 1
  settings: { latencyCompensationMs: number | null; [extra: string]: unknown }
  songs: Song[]
  [extra: string]: unknown
}
export type RecordingKind = 'video' | 'ses'
