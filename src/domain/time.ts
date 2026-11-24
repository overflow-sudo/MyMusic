import type { RecordingKind } from './types'

export function parseTimecode(s: string): number | null {
  const m = /^\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*$/.exec(s)
  if (!m) return null
  const sec = (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2])
  return Number.isFinite(sec) ? sec : null
}

export function formatTimecode(sec: number): string {
  const total = Math.max(0, Math.floor(sec))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const p2 = (n: number) => String(n).padStart(2, '0')

export function recordingFileName(d: Date, kind: RecordingKind): string {
  const date = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
  const time = `${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`
  return `${date}_${time}_${kind}.webm`
}

export function parseRecordingFileName(name: string): { date: Date; kind: RecordingKind } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})_(video|ses)\.webm$/.exec(name)
  if (!m) return null
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map(Number)
  return { date: new Date(y, mo - 1, d, h, mi, s), kind: m[7] as RecordingKind }
}
