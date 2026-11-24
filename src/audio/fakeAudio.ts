// Test doubles for Web Audio / MediaRecorder (jsdom has neither). Used by engine.test.ts only.
export class FakeParam {
  value = 1
  setValueAtTime(v: number) {
    this.value = v
    return this
  }
  exponentialRampToValueAtTime() {
    return this
  }
}

export class FakeNode {
  readonly outs: FakeNode[] = []
  readonly label: string
  constructor(label: string) {
    this.label = label
  }
  connect(n: FakeNode) {
    this.outs.push(n)
    return n
  }
  disconnect() {}
}

/** Terminal nodes (no outgoing connections) reachable from `n`. */
export function sinks(n: FakeNode): Set<FakeNode> {
  if (n.outs.length === 0) return new Set([n])
  const out = new Set<FakeNode>()
  for (const o of n.outs) for (const s of sinks(o)) out.add(s)
  return out
}

export class FakeOscillator extends FakeNode {
  frequency = new FakeParam()
  starts: number[] = []
  start(t: number) {
    this.starts.push(t)
  }
  stop() {}
}

export class FakeGain extends FakeNode {
  gain = new FakeParam()
}

export class FakeBufferSource extends FakeNode {
  buffer: unknown = null
  starts: [number, number][] = []
  stopped = false
  onended: (() => void) | null = null
  start(when: number, offset: number) {
    this.starts.push([when, offset])
  }
  stop() {
    this.stopped = true
  }
}

export class FakeStream {
  private readonly tracks: { kind: string; id: string }[]
  constructor(tracks: { kind: string; id: string }[] = []) {
    this.tracks = tracks
  }
  getTracks() {
    return this.tracks
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio')
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video')
  }
}

export class FakeStreamSource extends FakeNode {
  readonly mediaStream: unknown
  constructor(stream: unknown) {
    super('mic')
    this.mediaStream = stream
  }
}

export class FakeStreamDestination extends FakeNode {
  stream = new FakeStream([{ kind: 'audio', id: 'mixed-audio' }])
}

export class FakeAudioContext {
  static instances: FakeAudioContext[] = []
  static startTime = 10
  readonly options: unknown
  readonly created = Date.now()
  destination = new FakeNode('destination')
  baseLatency = 0.01
  outputLatency = 0.02
  closed = false
  sinkId: string | undefined
  oscillators: FakeOscillator[] = []
  gains: FakeGain[] = []
  bufferSources: FakeBufferSource[] = []
  micSources: FakeStreamSource[] = []
  recordDests: FakeStreamDestination[] = []
  constructor(options?: unknown) {
    this.options = options
    FakeAudioContext.instances.push(this)
  }
  get currentTime() {
    return FakeAudioContext.startTime + (Date.now() - this.created) / 1000
  }
  async setSinkId(id: string) {
    this.sinkId = id
  }
  async resume() {}
  async close() {
    this.closed = true
  }
  createOscillator() {
    const n = new FakeOscillator('osc')
    this.oscillators.push(n)
    return n
  }
  createGain() {
    const n = new FakeGain('gain')
    this.gains.push(n)
    return n
  }
  createBufferSource() {
    const n = new FakeBufferSource('track')
    this.bufferSources.push(n)
    return n
  }
  createMediaStreamSource(stream: unknown) {
    const n = new FakeStreamSource(stream)
    this.micSources.push(n)
    return n
  }
  createMediaStreamDestination() {
    const n = new FakeStreamDestination('recorded')
    this.recordDests.push(n)
    return n
  }
}

export class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  static isTypeSupported = (t: string) => t === 'audio/webm;codecs=opus' || t.startsWith('video/webm;codecs=vp9')
  readonly stream: FakeStream
  readonly options: unknown
  state: 'inactive' | 'recording' = 'inactive'
  timeslice: number | undefined
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  constructor(stream: FakeStream, options?: unknown) {
    this.stream = stream
    this.options = options
    FakeMediaRecorder.instances.push(this)
  }
  start(timeslice?: number) {
    this.state = 'recording'
    this.timeslice = timeslice
  }
  emit(text: string) {
    this.ondataavailable?.({ data: new Blob([text]) })
  }
  stop() {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    queueMicrotask(() => this.onstop?.())
  }
}

export function resetFakes() {
  FakeAudioContext.instances = []
  FakeMediaRecorder.instances = []
}
