export function defaultLatencyMs(
  ctx: { baseLatency?: number; outputLatency?: number },
  inputLatencySec = 0.01,
): number {
  const sec = (ctx.baseLatency ?? 0) + (ctx.outputLatency ?? 0) + inputLatencySec
  return Math.round(sec * 1000)
}

/** Opens a context on the given output and reads its latency, as a take would. null if unavailable. */
export async function measureAutoLatencyMs(outputDeviceId?: string): Promise<number | null> {
  if (typeof AudioContext === 'undefined') return null
  const ctx = new AudioContext({ sampleRate: 48000 }) as AudioContext & { setSinkId?: (id: string) => Promise<void> }
  try {
    if (outputDeviceId && ctx.setSinkId) await ctx.setSinkId(outputDeviceId).catch(() => undefined)
    await Promise.race([ctx.resume(), new Promise((r) => setTimeout(r, 1000))])
    return defaultLatencyMs(ctx)
  } finally {
    void ctx.close().catch(() => undefined)
  }
}
