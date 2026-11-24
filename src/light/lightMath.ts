export interface TakeBeatPlan {
  clickTimes: number[]
  downbeat: number
  bpm: number
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

/** 60 bpm → 230, ≥160 bpm → 15, linear between, clamped. */
export function hueForBpm(bpm: number): number {
  const t = clamp01((bpm - 60) / 100)
  return 230 + (15 - 230) * t
}

/** −60…0 dB → 0…1, clamped. */
export function levelFromDb(db: number): number {
  return clamp01((db + 60) / 60)
}

export function pulseFromPhase(phase: number): number {
  return Math.pow(1 - phase, 3)
}

/** Phase within the current beat; null before the first click. */
export function takePhase(now: number, p: TakeBeatPlan): number | null {
  const { clickTimes, downbeat, bpm } = p
  if (clickTimes.length > 0 && now < clickTimes[0]) return null
  if (now < downbeat) {
    let i = 0
    while (i + 1 < clickTimes.length && clickTimes[i + 1] <= now) i++
    const start = clickTimes[i]
    const end = i + 1 < clickTimes.length ? clickTimes[i + 1] : downbeat
    return (now - start) / (end - start)
  }
  const beat = 60 / bpm
  const ph = ((now - downbeat) / beat) % 1
  return ph < 0 ? ph + 1 : ph
}

export function freePhase(nowMs: number, bpm: number): number {
  const beatMs = 60000 / bpm
  return (nowMs % beatMs) / beatMs
}

/** 0..1 sine, period 6000 ms. */
export function breath(nowMs: number): number {
  return (1 - Math.cos((2 * Math.PI * nowMs) / 6000)) / 2
}
