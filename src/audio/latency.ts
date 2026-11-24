export function defaultLatencyMs(
  ctx: { baseLatency?: number; outputLatency?: number },
  inputLatencySec = 0.01,
): number {
  const sec = (ctx.baseLatency ?? 0) + (ctx.outputLatency ?? 0) + inputLatencySec
  return Math.round(sec * 1000)
}
