import type { RecordingKind, Song } from '../domain/types'
import { recordingFileName } from '../domain/time'
import { ChunkWriter } from '../storage/chunkWriter'
import type { FsDir } from '../storage/fsDir'
import { planCountIn } from './countInPlan'
import { buildGraph, type Graph, type TrackInput } from './graph'
import { defaultLatencyMs } from './latency'
import { pickMimeType } from './mime'
import { nextState, type SessionEvent, type SessionState } from './sessionMachine'

export const WRITE_ERROR = 'Kayıt diske yazılamadı.'
export const START_ERROR = 'Kayıt başlatılamadı.'
export const RECORDER_ERROR = 'Kayıt sırasında bir hata oluştu.'
export const SINK_NOTICE =
  "Metronom çıkışı açılamadı, varsayılan çıkış kullanılıyor. Tık kayda girmesin: Voicemeeter'da tarayıcı sesini yalnızca A1'e (kulaklık) gönder, B hattına gönderme."

const AUTO_STOP_MS = 2000
const TIMESLICE_MS = 1000

export interface TakeOptions {
  kind: RecordingKind
  song: Song
  root: FsDir
  /** mic (+ camera video track for 'video'), from the Recorder preview; not stopped by the engine. */
  input: MediaStream
  /** metronome + track headphones sink */
  outputDeviceId?: string
  track?: TrackInput
  /** null = auto (defaultLatencyMs of this take's AudioContext) */
  latencyMs: number | null
  onState(s: SessionState): void
  onCountdown(beatsLeft: number): void
  onElapsed(sec: number): void
  /** Non-fatal hint, e.g. the chosen output could not be opened. */
  onNotice?(message: string): void
}
/** done: the file name, or null if cancelled; rejects with a Turkish message on failure. */
export interface Take { stop(): void; cancel(): void; done: Promise<string | null> }
export interface EngineDeps {
  AudioContext?: typeof AudioContext
  MediaRecorder?: typeof MediaRecorder
  MediaStream?: typeof MediaStream
  now?: () => Date
}

type SinkContext = AudioContext & { setSinkId?: (id: string) => Promise<void> }

export function startTake(o: TakeOptions, deps: EngineDeps = {}): Take {
  const AC = deps.AudioContext ?? window.AudioContext
  const MR = deps.MediaRecorder ?? window.MediaRecorder
  const MS = deps.MediaStream ?? window.MediaStream
  const now = deps.now ?? (() => new Date())

  let state: SessionState = 'idle'
  let settled = false
  let ctx: AudioContext | null = null
  let graph: Graph | null = null
  let recorder: MediaRecorder | null = null
  let writer: Promise<ChunkWriter> | null = null
  let writes: Promise<void> = Promise.resolve()
  const timers: ReturnType<typeof setTimeout>[] = []
  let ticker: ReturnType<typeof setInterval> | undefined
  let resolveDone!: (v: string | null) => void
  let rejectDone!: (e: Error) => void
  const done = new Promise<string | null>((res, rej) => {
    resolveDone = res
    rejectDone = rej
  })

  const current = (): SessionState => state // read through a call: state changes in callbacks
  const go = (e: SessionEvent) => {
    const n = nextState(state, e)
    if (n === state) return
    state = n
    o.onState(n)
  }
  const stopClock = () => {
    timers.forEach(clearTimeout)
    clearInterval(ticker)
  }
  const teardown = () => {
    stopClock()
    graph?.stopTrack()
    void ctx?.close().catch(() => undefined)
    ctx = null
  }
  const settle = (v: string | null) => {
    settled = true
    resolveDone(v)
  }

  // Any write failure is fatal: stop, keep .parcalar for recovery, never finalize a truncated file.
  const fail = (message: string) => {
    if (settled) return
    settled = true
    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = null
      try {
        recorder.stop()
      } catch {
        /* already broken */
      }
    }
    teardown()
    go('FAIL')
    rejectDone(new Error(message))
  }

  const cancel = () => {
    if (state !== 'countingIn' || settled) return
    teardown()
    go('CANCEL')
    settle(null)
  }

  const finish = (e: 'STOP' | 'TRACK_ENDED') => {
    if (state !== 'recording' || settled) return
    go(e)
    stopClock()
    graph?.stopTrack()
    try {
      recorder!.stop()
    } catch {
      fail(RECORDER_ERROR)
    }
  }

  const onData = (e: BlobEvent) => {
    if (!e.data || e.data.size === 0) return
    const chunk = e.data
    writes = writes
      .then(async () => {
        if (settled) return
        await (await writer!).append(chunk)
      })
      .catch(() => fail(WRITE_ERROR))
  }

  const onStop = async () => {
    await writes
    if (settled) return
    try {
      const name = await (await writer!).finalize()
      teardown()
      go('FINALIZED')
      settle(name)
    } catch {
      fail(WRITE_ERROR)
    }
  }

  const at = (c: AudioContext, t: number, fn: () => void) =>
    timers.push(setTimeout(fn, Math.max(0, (t - c.currentTime) * 1000)))

  go('START')
  o.onCountdown(o.song.countInBeats)

  void (async () => {
    let c: SinkContext
    try {
      c = ctx = new AC({ sampleRate: 48000 })
      if (o.outputDeviceId && typeof c.setSinkId === 'function') {
        await c.setSinkId(o.outputDeviceId).catch(() => o.onNotice?.(SINK_NOTICE))
      }
      await c.resume()
    } catch {
      return fail(START_ERROR)
    }
    if (current() !== 'countingIn' || settled) return // cancelled while the context was opening

    const plan = planCountIn({ bpm: o.song.bpm, beats: o.song.countInBeats, now: c.currentTime })
    const rec = (() => {
      try {
        graph = buildGraph(c, { input: o.input, plan, track: o.track, latencyMs: o.latencyMs ?? defaultLatencyMs(c) })
        const video = o.kind === 'video' ? o.input.getVideoTracks() : []
        const stream = new MS([...graph.recorded.stream.getAudioTracks(), ...video])
        const mimeType = pickMimeType(o.kind, (t) => MR.isTypeSupported(t))
        return new MR(stream, { mimeType, audioBitsPerSecond: 256000 })
      } catch {
        return null
      }
    })()
    if (!rec) return fail(START_ERROR)
    recorder = rec
    rec.ondataavailable = onData
    rec.onstop = () => void onStop()
    rec.onerror = () => fail(RECORDER_ERROR)

    const hp = graph!.headphonesTrack
    if (hp) hp.onended = () => state === 'recording' && timers.push(setTimeout(() => finish('TRACK_ENDED'), AUTO_STOP_MS))

    const beats = plan.clickTimes.length
    plan.clickTimes.forEach((t, i) => i > 0 && at(c, t, () => o.onCountdown(beats - i)))
    // The writer starts only here, so a cancelled count-in leaves nothing on disk.
    at(c, plan.recorderStart, () => {
      if (state !== 'countingIn' || settled) return
      const meta = { songFolderName: o.song.folderName, fileName: recordingFileName(now(), o.kind) }
      writer = ChunkWriter.start(o.root, crypto.randomUUID(), meta)
      writer.catch(() => fail(WRITE_ERROR))
      try {
        rec.start(TIMESLICE_MS)
      } catch {
        return fail(START_ERROR)
      }
      go('COUNT_DONE')
      o.onElapsed(0)
      ticker = setInterval(() => ctx && o.onElapsed(Math.max(0, ctx.currentTime - plan.downbeat)), 250)
    })
  })()

  return {
    stop: () => (state === 'countingIn' ? cancel() : finish('STOP')),
    cancel,
    done,
  }
}

/** Decodes at the engine's sample rate without opening an output device. */
export async function decodeTrack(file: Blob): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: 1, sampleRate: 48000 })
  return ctx.decodeAudioData(await file.arrayBuffer())
}
