import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createSong } from '../domain/library'
import type { Song } from '../domain/types'
import type { FsDir } from '../storage/fsDir'
import { createMemoryDir } from '../storage/memoryDir'
import { startTake, type TakeOptions } from './engine'
import { FakeAudioContext, FakeMediaRecorder, FakeStream, resetFakes, sinks } from './fakeAudio'
import type { SessionState } from './sessionMachine'

const NOW = new Date(2026, 10, 24, 21, 30, 5)
const song: Song = createSong({ title: 'Wonderwall', artist: 'Oasis', status: 'learning', bpm: 120, countInBeats: 4 }, NOW, 's1')

const deps = {
  AudioContext: FakeAudioContext as unknown as typeof AudioContext,
  MediaRecorder: FakeMediaRecorder as unknown as typeof MediaRecorder,
  MediaStream: FakeStream as unknown as typeof MediaStream,
  now: () => NOW,
}

function setup(over: Partial<TakeOptions> = {}) {
  const states: SessionState[] = []
  const countdown: number[] = []
  const root = over.root ?? createMemoryDir()
  const input = new FakeStream([
    { kind: 'audio', id: 'mic-audio' },
    { kind: 'video', id: 'cam-video' },
  ]) as unknown as MediaStream
  const take = startTake(
    {
      kind: 'ses',
      song,
      root,
      input,
      latencyMs: 45,
      onState: (s) => states.push(s),
      onCountdown: (n) => countdown.push(n),
      onElapsed: () => {},
      ...over,
    },
    deps,
  )
  return { take, root, states, countdown, input, ctx: () => FakeAudioContext.instances[0], rec: () => FakeMediaRecorder.instances[0] }
}

const buffer = { duration: 200 } as unknown as AudioBuffer

async function song_dir(root: FsDir) {
  return (await (await root.dir('recordings'))?.dir(song.folderName)) ?? null
}

beforeEach(() => {
  resetFakes()
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('startTake', () => {
  it('schedules headphones track at the downbeat and the recorded copy delayed by latency', async () => {
    const { ctx } = setup({ track: { buffer, startSec: 12, volume: 0.5 } })
    await vi.advanceTimersByTimeAsync(0)
    const c = ctx()
    expect(c.options).toEqual({ sampleRate: 48000 })
    expect(c.bufferSources).toHaveLength(2)
    const hp = c.bufferSources.find((s) => sinks(s).has(c.destination))!
    const recorded = c.bufferSources.find((s) => sinks(s).has(c.recordDests[0]))!
    expect(hp).toBeDefined()
    expect(recorded).toBeDefined()
    expect([...sinks(hp)]).toEqual([c.destination])
    expect([...sinks(recorded)]).toEqual([c.recordDests[0]])
    expect(hp.starts).toHaveLength(1)
    expect(hp.starts[0][0]).toBeCloseTo(12.1, 9)
    expect(hp.starts[0][1]).toBe(12)
    expect(recorded.starts[0][0]).toBeCloseTo(12.145, 9)
    expect(recorded.starts[0][1]).toBe(12)
    expect(hp.buffer).toBe(buffer)
    expect(recorded.buffer).toBe(buffer)
    // both paths go through a gain at the track volume
    for (const s of [hp, recorded]) {
      const gain = c.gains.find((g) => s.outs.includes(g))!
      expect(gain.gain.value).toBe(0.5)
    }
  })

  it('clicks reach only the speakers; the mic reaches only the recorded stream', async () => {
    const { ctx } = setup()
    await vi.advanceTimersByTimeAsync(0)
    const c = ctx()
    expect(c.oscillators.map((o) => o.frequency.value)).toEqual([1500, 1000, 1000, 1000])
    const times = c.oscillators.map((o) => o.starts[0])
    ;[10.1, 10.6, 11.1, 11.6].forEach((t, i) => expect(times[i]).toBeCloseTo(t, 9))
    for (const o of c.oscillators) expect([...sinks(o)]).toEqual([c.destination])
    expect(c.micSources).toHaveLength(1)
    expect([...sinks(c.micSources[0])]).toEqual([c.recordDests[0]])
    expect(c.bufferSources).toHaveLength(0)
  })

  it('routes the output to the chosen device', async () => {
    const { ctx } = setup({ outputDeviceId: 'm-audio' })
    await vi.advanceTimersByTimeAsync(0)
    expect(ctx().sinkId).toBe('m-audio')
  })

  it('cancel during count-in resolves null and writes nothing', async () => {
    const { take, root, states, ctx } = setup()
    await vi.advanceTimersByTimeAsync(500)
    take.cancel()
    await expect(take.done).resolves.toBeNull()
    await vi.advanceTimersByTimeAsync(5000)
    expect(FakeMediaRecorder.instances.every((r) => r.state === 'inactive')).toBe(true)
    expect(await root.list()).toEqual([])
    expect(states).toEqual(['countingIn', 'idle'])
    expect(ctx().closed).toBe(true)
  })

  it('stop during count-in also cancels', async () => {
    const { take, root } = setup()
    await vi.advanceTimersByTimeAsync(500)
    take.stop()
    await expect(take.done).resolves.toBeNull()
    expect(await root.list()).toEqual([])
  })

  it('counts down once per click', async () => {
    const { countdown } = setup()
    await vi.advanceTimersByTimeAsync(1700)
    expect(countdown).toEqual([4, 3, 2, 1])
  })

  it('stop after 3 chunks writes the concatenated file', async () => {
    const { take, root, states, rec, ctx } = setup()
    await vi.advanceTimersByTimeAsync(1900)
    expect(states).toEqual(['countingIn'])
    await vi.advanceTimersByTimeAsync(50)
    expect(states).toEqual(['countingIn', 'recording'])
    const r = rec()
    expect(r.options).toEqual({ mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 256000 })
    expect(r.timeslice).toBe(1000)
    expect(r.stream.getTracks().map((t) => t.id)).toEqual(['mixed-audio'])
    r.emit('a')
    r.emit('b')
    r.emit('c')
    take.stop()
    await expect(take.done).resolves.toBe('2026-11-24_21-30-05_ses.webm')
    const file = await (await song_dir(root))!.readFile('2026-11-24_21-30-05_ses.webm')
    expect(await file!.text()).toBe('abc')
    expect(await (await root.dir('.parcalar'))!.list()).toEqual([])
    expect(states).toEqual(['countingIn', 'recording', 'finalizing', 'idle'])
    expect(ctx().closed).toBe(true)
  })

  it('video takes carry the camera track alongside the mixed audio', async () => {
    const { take, rec } = setup({ kind: 'video' })
    await vi.advanceTimersByTimeAsync(1950)
    expect(rec().stream.getTracks().map((t) => t.id)).toEqual(['mixed-audio', 'cam-video'])
    expect((rec().options as { mimeType: string }).mimeType).toBe('video/webm;codecs=vp9,opus')
    rec().emit('v')
    take.stop()
    await expect(take.done).resolves.toBe('2026-11-24_21-30-05_video.webm')
  })

  it('auto-stops 2 s after the headphones track ends', async () => {
    const { take, states, ctx } = setup({ track: { buffer, startSec: 0, volume: 0.7 } })
    await vi.advanceTimersByTimeAsync(1950)
    const c = ctx()
    const hp = c.bufferSources.find((s) => sinks(s).has(c.destination))!
    hp.onended?.()
    await vi.advanceTimersByTimeAsync(1999)
    expect(states).not.toContain('finalizing')
    await vi.advanceTimersByTimeAsync(1)
    expect(states).toContain('finalizing')
    await expect(take.done).resolves.toBe('2026-11-24_21-30-05_ses.webm')
  })

  it('a stop-induced track end does not trigger a second stop', async () => {
    const { take, states, ctx } = setup({ track: { buffer, startSec: 0, volume: 0.7 } })
    await vi.advanceTimersByTimeAsync(1950)
    take.stop()
    const c = ctx()
    c.bufferSources.find((s) => sinks(s).has(c.destination))!.onended?.()
    await take.done
    await vi.advanceTimersByTimeAsync(3000)
    expect(states).toEqual(['countingIn', 'recording', 'finalizing', 'idle'])
  })

  it('uses the auto latency when latencyMs is null', async () => {
    const { ctx } = setup({ latencyMs: null, track: { buffer, startSec: 0, volume: 0.7 } })
    await vi.advanceTimersByTimeAsync(0)
    const c = ctx()
    const recorded = c.bufferSources.find((s) => sinks(s).has(c.recordDests[0]))!
    // baseLatency 10 ms + outputLatency 20 ms + 10 ms input estimate
    expect(recorded.starts[0][0]).toBeCloseTo(12.1 + 0.04, 9)
  })

  it('a failed chunk write is fatal: error state, rejection, parts kept for recovery', async () => {
    const root = failingParts(createMemoryDir())
    const { take, states, rec } = setup({ root })
    const done = take.done.catch((e: Error) => e.message)
    await vi.advanceTimersByTimeAsync(1950)
    rec().emit('a')
    await vi.advanceTimersByTimeAsync(0)
    expect(await done).toBe('Kayıt diske yazılamadı.')
    expect(states.at(-1)).toBe('error')
    expect(rec().state).toBe('inactive')
    const pending = await root.dir('.parcalar')
    expect((await pending!.list()).length).toBe(1)
    expect(await root.dir('recordings')).toBeNull()
  })
})

/** Wraps a dir so that writing any `*.part` file anywhere below it fails. */
function failingParts(d: FsDir): FsDir {
  return {
    ...d,
    dir: async (name, opts) => {
      const sub = await d.dir(name, opts)
      return sub && failingParts(sub)
    },
    writeFile: async (name, data) => {
      if (name.endsWith('.part')) throw new Error('disk full')
      return d.writeFile(name, data)
    },
  }
}
