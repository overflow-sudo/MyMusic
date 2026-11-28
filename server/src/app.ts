import { createServer, type Server } from 'node:http'
import type { Config } from './config.ts'
import { openDb, type Db } from './db.ts'
import { Auth } from './auth.ts'
import { Router } from './http.ts'
import { Files } from './files.ts'
import { Library } from './library.ts'
import { Uploads } from './uploads.ts'
import { registerLibraryRoutes } from './routes.ts'
import { Recordings, registerRecordingRoutes } from './recordings.ts'
import { Shares, registerShareRoutes } from './share.ts'
import { registerPageRoutes } from './pages.ts'
import { realRunner, Transcoder, type MediaRunner } from './transcode.ts'
import { consoleLogger, type Logger } from './log.ts'

export interface App {
  server: Server
  db: Db
  router: Router
  uploads: Uploads
  files: Files
  library: Library
  recordings: Recordings
  transcoder: Transcoder
  auth: Auth
  close(): Promise<void>
}

export function createApp(config: Config, logger: Logger = consoleLogger, opts: { media?: MediaRunner; transcodeTimeoutMs?: number } = {}): App {
  const db = openDb(config.dataDir)
  const auth = new Auth(db, config)
  const router = new Router({ allowedOrigins: config.allowedOrigins, logger, authenticate: auth.authenticate })

  router.add('GET', '/health', () => ({ ok: true }), { auth: false })
  router.add('POST', '/api/login', (ctx) => auth.login(ctx.ip, (ctx.body as { password?: unknown } | undefined)?.password), { auth: false })
  const files = new Files(db, config.dataDir)
  const library = new Library(db, files)
  const uploads = new Uploads(db, config.dataDir, config.maxUploadBytes)
  registerLibraryRoutes(router, library, files, uploads)
  const transcoder = new Transcoder(db, files.filesRoot, opts.media ?? realRunner, logger, opts.transcodeTimeoutMs)
  const recordings = new Recordings(db, files, library, transcoder, config)
  registerRecordingRoutes(router, recordings, uploads)
  const shares = new Shares(db, config, files, recordings)
  registerShareRoutes(router, shares)
  registerPageRoutes(router, { auth, recordings, library, files, shares })
  recordings.sweep()
  transcoder.start()

  const sweep = () => { uploads.cleanupStaleUploads().catch((e) => logger.error('upload cleanup failed', { message: String(e) })) }
  files.sweepTmp().catch((e) => logger.error('tmp sweep failed', { message: String(e) }))
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
    server, db, router, auth, uploads, files, library, recordings, transcoder,
    close: async () => {
      clearInterval(timer)
      await transcoder.stop()
      await new Promise<void>((resolve) => server.close(() => { db.close(); resolve() }))
    },
  }
}
