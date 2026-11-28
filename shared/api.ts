// Wire types shared by the browser app and the server. Types only.
export interface SongRecord {
  id: string
  title: string
  artist: string
  updatedAt: string
  deletedAt?: string
  [extra: string]: unknown
}

export interface RecordingInfo {
  id: string
  songId: string
  kind: 'video' | 'ses'
  recordedAt: string
  fileName: string
  size: number
  durationSec: number | null
  status: 'processing' | 'ready' | 'failed'
  songTitle: string
  songArtist: string
  /** True once a share link exists (shareUrl is returned only by the share endpoints). */
  shared: boolean
  shareUrl?: string
}

/** Deleted recording: the id is kept so other computers delete their copy too. */
export interface RecordingTombstone { id: string; deleted: true }
export type RecordingListItem = RecordingInfo | RecordingTombstone

export interface LoginResponse { token: string }

export interface ApiError { error: string }
