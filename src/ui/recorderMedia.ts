import { audioConstraints, videoConstraints } from '../audio/constraints'
import { listDevices } from '../audio/devices'
import type { RecordingKind } from '../domain/types'

export type Devices = { mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[]; outs: MediaDeviceInfo[] }
export const noDevices: Devices = { mics: [], cams: [], outs: [] }
export const errName = (e: unknown) => (e instanceof Error || e instanceof DOMException ? e.name : '')

export async function mediaErrorMessage(e: unknown, kind: RecordingKind): Promise<string> {
  const name = errName(e)
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return kind === 'video' ? 'Kamera ve mikrofona erişim izni verilmedi.' : 'Mikrofona erişim izni verilmedi.'
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    if (kind === 'ses') return 'Mikrofon bulunamadı.'
    const d = await listDevices().catch(() => noDevices)
    return d.mics.length === 0 && d.cams.length > 0 ? 'Mikrofon bulunamadı.' : 'Kamera bulunamadı.'
  }
  if (name === 'NotReadableError') return 'Cihaz açılamadı; başka bir uygulama kullanıyor olabilir.'
  return 'Cihaz açılamadı.'
}

export function openStream(kind: RecordingKind, mic: string, cam: string) {
  return navigator.mediaDevices.getUserMedia({
    audio: audioConstraints(mic || undefined),
    video: kind === 'video' ? videoConstraints(cam || undefined) : false,
  })
}

export const stopStream = (s: MediaStream | null) => s?.getTracks().forEach((t) => t.stop())

/** "Mikrofon · Voicemeeter Out B1" / "Kamera · HD Webcam" for the stage corner. */
export function inputLabel(kind: RecordingKind, stream: MediaStream | null): string {
  const track = kind === 'video' ? stream?.getVideoTracks?.()[0] : stream?.getAudioTracks?.()[0]
  const name = kind === 'video' ? 'Kamera' : 'Mikrofon'
  return track?.label ? `${name} · ${track.label}` : name
}
