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
  shareUrl?: string
  deleted?: boolean
}

export interface LoginResponse { token: string }

export interface ApiError { error: string }
