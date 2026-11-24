export function planCountIn(o: {
  bpm: number
  beats: number
  now: number
  leadInSec?: number
  preRollSec?: number
}): { clickTimes: number[]; accent: boolean[]; downbeat: number; recorderStart: number } {
  const lead = o.leadInSec ?? 0.1
  const preRoll = o.preRollSec ?? 0.15
  const interval = 60 / o.bpm
  const first = o.now + lead
  const clickTimes = Array.from({ length: o.beats }, (_, i) => first + i * interval)
  const accent = clickTimes.map((_, i) => i === 0)
  const downbeat = first + o.beats * interval
  return { clickTimes, accent, downbeat, recorderStart: downbeat - preRoll }
}
