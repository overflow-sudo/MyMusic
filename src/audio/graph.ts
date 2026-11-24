import type { planCountIn } from './countInPlan'

export type CountInPlan = ReturnType<typeof planCountIn>
export interface TrackInput { buffer: AudioBuffer; startSec: number; volume: number }

export interface Graph {
  /** What MediaRecorder records: mic + delayed track. Never the clicks. */
  recorded: MediaStreamAudioDestinationNode
  /** The source the user hears; its end drives auto-stop. */
  headphonesTrack?: AudioBufferSourceNode
  stopTrack(): void
}

const CLICK_SEC = 0.03

/** Metronome clicks go to the speakers (ctx.destination) only. */
function scheduleClicks(ctx: AudioContext, plan: CountInPlan) {
  plan.clickTimes.forEach((t, i) => {
    const osc = ctx.createOscillator()
    osc.frequency.value = plan.accent[i] ? 1500 : 1000
    const env = ctx.createGain()
    env.gain.setValueAtTime(0.8, t)
    env.gain.exponentialRampToValueAtTime(0.001, t + CLICK_SEC)
    osc.connect(env)
    env.connect(ctx.destination)
    osc.start(t)
    osc.stop(t + CLICK_SEC)
  })
}

function trackSource(ctx: AudioContext, track: TrackInput, to: AudioNode, when: number) {
  const src = ctx.createBufferSource()
  src.buffer = track.buffer
  const gain = ctx.createGain()
  gain.gain.value = track.volume
  src.connect(gain)
  gain.connect(to)
  src.start(when, track.startSec)
  return src
}

export function buildGraph(
  ctx: AudioContext,
  o: { input: MediaStream; plan: CountInPlan; track?: TrackInput; latencyMs: number },
): Graph {
  scheduleClicks(ctx, o.plan)
  const recorded = ctx.createMediaStreamDestination()
  // Not to ctx.destination: the user monitors the guitar through Voicemeeter.
  ctx.createMediaStreamSource(o.input).connect(recorded)
  if (!o.track) return { recorded, stopTrack: () => {} }
  const headphonesTrack = trackSource(ctx, o.track, ctx.destination, o.plan.downbeat)
  const recordedTrack = trackSource(ctx, o.track, recorded, o.plan.downbeat + o.latencyMs / 1000)
  return {
    recorded,
    headphonesTrack,
    stopTrack: () => {
      for (const s of [headphonesTrack, recordedTrack]) {
        try {
          s.stop()
        } catch {
          /* not started yet or already stopped */
        }
      }
    },
  }
}
