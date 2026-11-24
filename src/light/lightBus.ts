import type { TakeBeatPlan } from './lightMath'

export type BeatSource =
  | { kind: 'breath' }
  | { kind: 'free'; bpm: number }
  | { kind: 'take'; ctx: { currentTime: number }; plan: TakeBeatPlan }

let level = 0
let source: BeatSource = { kind: 'breath' }
let hueBpm: number | null = null

export const lightBus = {
  setLevel(v: number) { level = v },
  getLevel: () => level,
  setSource(s: BeatSource) { source = s },
  getSource: () => source,
  setHueBpm(bpm: number | null) { hueBpm = bpm },
  getHueBpm: () => hueBpm,
}
