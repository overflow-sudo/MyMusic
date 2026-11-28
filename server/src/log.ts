const SECRET_KEYS = /^(authorization|cookie|set-cookie|password|token|secret|signing_secret|owner_password)$/i

export interface Logger {
  info(msg: string, fields?: Record<string, unknown>): void
  error(msg: string, fields?: Record<string, unknown>): void
}

function clean(fields?: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields ?? {})) out[k] = SECRET_KEYS.test(k) ? '[redacted]' : v
  return out
}

export const consoleLogger: Logger = {
  info: (msg, fields) => console.log(msg, clean(fields)),
  error: (msg, fields) => console.error(msg, clean(fields)),
}
