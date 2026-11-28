import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { createApp, type App } from '../src/app.ts'
import { loadConfig, type Config } from '../src/config.ts'
import type { Logger } from '../src/log.ts'

type AppOpts = NonNullable<Parameters<typeof createApp>[2]>
export const PASSWORD = 'test-password-dummy'

export interface Harness {
  app: App; base: string; config: Config
  logs: string[]
  stop(): Promise<void>
}

export async function start(env: Record<string, string> = {}, appOpts: AppOpts = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'mm-server-'))
  const config = loadConfig({ OWNER_PASSWORD: PASSWORD, SIGNING_SECRET: 'dummy-secret', DATA_DIR: dir, ...env })
  const logs: string[] = []
  const logger: Logger = {
    info: (m, f) => { logs.push(JSON.stringify([m, f])) },
    error: (m, f) => { logs.push(JSON.stringify([m, f])) },
  }
  const app = createApp(config, logger, appOpts)
  await new Promise<void>((r) => app.server.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`
  return { app, base, config, logs, async stop() { await app.close(); rmSync(dir, { recursive: true, force: true }) } }
}

export const login = (h: Harness, password: string, headers: Record<string, string> = {}) =>
  fetch(h.base + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ password }),
  })
