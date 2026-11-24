import type { TakeBeatPlan } from './lightMath'

export type BeatSource =
  | { kind: 'breath' }
  | { kind: 'free'; bpm: number }
  | { kind: 'take'; ctx: { currentTime: number }; plan: TakeBeatPlan }

let level = 0
let source: BeatSource = { kind: 'breath' }
let hueBpm: number | null = null
const hueListeners = new Set<() => void>()

export const lightBus = {
  setLevel(v: number) { level = v },
  getLevel: () => level,
  setSource(s: BeatSource) { source = s },
  getSource: () => source,
  setHueBpm(bpm: number | null) {
    if (bpm === hueBpm) return
    hueBpm = bpm
    hueListeners.forEach((l) => l())
  },
  getHueBpm: () => hueBpm,
  /** Notified when the song hue BPM changes (the reduced-motion glow has no frame loop to pick it up). */
  onHueBpmChange(l: () => void) {
    hueListeners.add(l)
    return () => void hueListeners.delete(l)
  },
}
