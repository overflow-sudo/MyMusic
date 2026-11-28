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
  return Math.pow(1 - clamp01(phase), 3)
}

/** Phase within the current beat; null before the first click. */
export function takePhase(now: number, p: TakeBeatPlan): number | null {
  const { clickTimes, downbeat, bpm } = p
  if (now < (clickTimes.length > 0 ? clickTimes[0] : downbeat)) return null
  if (now < downbeat) {
    let i = 0
    while (i + 1 < clickTimes.length && clickTimes[i + 1] <= now) i++
    const start = clickTimes[i]
    const end = i + 1 < clickTimes.length ? clickTimes[i + 1] : downbeat
    const interval = end - start
    return interval > 0 ? (now - start) / interval : 0
  }
  const beat = 60 / bpm
  if (!(beat > 0) || !Number.isFinite(beat)) return 0
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

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)

/** Hue (0..360) of a #rrggbb color. */
export function hexToHue(hex: string): number {
  const [r, g, b] = rgb(hex)
  const max = Math.max(r, g, b)
  const d = max - Math.min(r, g, b)
  if (d === 0) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}

/** HSL saturation (0..1) of a #rrggbb color. */
export function hexSaturation(hex: string): number {
  const [r, g, b] = rgb(hex)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1))
}

export const SAT_FLOOR = 0.4

/** Hue to paint: a fixed color wins and ignores the guitar level; otherwise tempo hue plus level. */
export function hueFor(bpm: number | null, level: number, color: string | null): number {
  if (color) return hexToHue(color)
  return (bpm === null ? 205 : hueForBpm(bpm)) + level * 30
}
