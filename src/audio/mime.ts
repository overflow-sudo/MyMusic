import type { RecordingKind } from '../domain/types'

const VIDEO = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
const AUDIO = ['audio/webm;codecs=opus', 'audio/webm']

export function pickMimeType(kind: RecordingKind, isSupported: (t: string) => boolean): string {
  const list = kind === 'video' ? VIDEO : AUDIO
  return list.find(isSupported) ?? list[list.length - 1]
}
