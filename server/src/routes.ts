import type { Files, FileKind } from './files.ts'
import { HttpError, type Router } from './http.ts'
import type { Library } from './library.ts'
import { validId } from './ids.ts'
import type { Uploads } from './uploads.ts'

export function registerLibraryRoutes(router: Router, lib: Library, files: Files, uploads: Uploads): void {
  router.add('GET', '/api/library', () => ({ songs: lib.list() }))
  router.add('PUT', '/api/songs/:id', (ctx) => lib.put(ctx.params.id, ctx.body))

  for (const kind of ['track', 'cover'] as FileKind[]) {
    router.add('GET', `/api/songs/:id/${kind}`, (ctx) => files.serve(ctx, kind))
    router.add('DELETE', `/api/songs/:id/${kind}`, async (ctx) => {
      const id = validId(ctx.params.id, 'song id')
      if (!(await files.remove(id, kind))) throw new HttpError(404, 'No file')
      return { ok: true }
    })
    uploads.registerTarget(kind, async ({ body, parts }) => {
      const songId = validId(body.songId, 'song id')
      if (lib.status(songId) !== 'live') throw new HttpError(409, 'Unknown or deleted song')
      return files.store(songId, kind, body.fileName, body.mime, parts, () => lib.status(songId) === 'live')
    })
  }

  router.add('POST', '/api/uploads', () => uploads.create())
  router.add('DELETE', '/api/uploads/:id', (ctx) => uploads.abort(ctx.params.id))
  router.add('PUT', '/api/uploads/:id/:n', (ctx) => uploads.putPart(ctx), { json: false })
  router.add('POST', '/api/uploads/:id/complete', (ctx) => uploads.complete(ctx.params.id, ctx.body))
}
