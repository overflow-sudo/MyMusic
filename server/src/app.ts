import { createServer, type Server } from 'node:http'
import type { Config } from './config.ts'
import { openDb, type Db } from './db.ts'
import { Auth } from './auth.ts'
import { Router } from './http.ts'
import { Files } from './files.ts'
import { Library } from './library.ts'
import { Uploads } from './uploads.ts'
import { registerLibraryRoutes } from './routes.ts'
import { consoleLogger, type Logger } from './log.ts'

export interface App {
  server: Server
  db: Db
  router: Router
  uploads: Uploads
  files: Files
  library: Library
  auth: Auth
  close(): Promise<void>
}

export function createApp(config: Config, logger: Logger = consoleLogger): App {
  const db = openDb(config.dataDir)
  const auth = new Auth(db, config)
  const router = new Router({ allowedOrigins: config.allowedOrigins, logger, authenticate: auth.authenticate })

  router.add('GET', '/health', () => ({ ok: true }), { auth: false })
  router.add('POST', '/api/login', (ctx) => auth.login(ctx.ip, (ctx.body as { password?: unknown } | undefined)?.password), { auth: false })
  const files = new Files(db, config.dataDir)
  const library = new Library(db, files)
  const uploads = new Uploads(db, config.dataDir, config.maxUploadBytes)
  registerLibraryRoutes(router, library, files, uploads)

  const sweep = () => { uploads.cleanupStaleUploads().catch((e) => logger.error('upload cleanup failed', { message: String(e) })) }
  sweep()
  const timer = setInterval(sweep, 60 * 60 * 1000)
  timer.unref()

  const server = createServer((req, res) => {
    router.handler(req, res).catch((e) => {
      logger.error('handler crashed', { message: e instanceof Error ? e.message : String(e) })
      res.destroy()
    })
  })
  return {
    server, db, router, auth, uploads, files, library,
    close: () => new Promise((resolve) => { clearInterval(timer); server.close(() => { db.close(); resolve() }) }),
  }
}
