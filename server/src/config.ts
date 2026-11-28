export interface Config {
  port: number
  dataDir: string
  ownerPassword: string
  signingSecret: string
  publicUrl: string
  allowedOrigins: string[]
  maxUploadBytes: number
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (!env.OWNER_PASSWORD) throw new Error('OWNER_PASSWORD is required')
  if (!env.SIGNING_SECRET) throw new Error('SIGNING_SECRET is required')
  if (env.OWNER_PASSWORD === 'change-me' || env.OWNER_PASSWORD.length < 12)
    throw new Error('OWNER_PASSWORD must be changed from the placeholder and be at least 12 characters (try: openssl rand -base64 24)')
  const num = (name: string, def: number): number => {
    const raw = env[name]
    if (raw === undefined || raw === '') return def
    const n = Number(raw)
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${name} must be a positive integer`)
    return n
  }
  return {
    port: num('PORT', 8120),
    dataDir: env.DATA_DIR || '/data',
    ownerPassword: env.OWNER_PASSWORD,
    signingSecret: env.SIGNING_SECRET,
    publicUrl: (env.PUBLIC_URL || 'https://music.emiraksu.me').replace(/\/+$/, ''),
    allowedOrigins: (env.ALLOWED_ORIGINS ||
      'https://overflow-sudo.github.io,http://localhost:5173,http://localhost:5174')
      .split(',').map((s) => s.trim()).filter(Boolean),
    maxUploadBytes: num('MAX_UPLOAD_BYTES', 4294967296),
  }
}
