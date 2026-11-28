import { createServer, type Server } from 'node:http'
import type { Config } from './config.ts'
import { openDb, type Db } from './db.ts'
import { Auth } from './auth.ts'
import { Router } from './http.ts'
import { consoleLogger, type Logger } from './log.ts'

export interface App {
  server: Server
  db: Db
  router: Router
  auth: Auth
  close(): Promise<void>
}

export function createApp(config: Config, logger: Logger = consoleLogger): App {
  const db = openDb(config.dataDir)
  const auth = new Auth(db, config)
  const router = new Router({ allowedOrigins: config.allowedOrigins, logger, authenticate: auth.authenticate })

  router.add('GET', '/health', () => ({ ok: true }), { auth: false })
  router.add('POST', '/api/login', (ctx) => auth.login(ctx.ip, (ctx.body as { password?: unknown } | undefined)?.password), { auth: false })
  // Placeholder until Task 5 (library sync).
  router.add('GET', '/api/library', () => ({ songs: [] }))

  const server = createServer((req, res) => { void router.handler(req, res) })
  return {
    server, db, router, auth,
    close: () => new Promise((resolve) => server.close(() => { db.close(); resolve() })),
  }
}
