import { CloudError, createApi } from './api'
import { recordingId } from './hash'
import { getSession, type Session } from './session'

export interface PendingDeletes {
  addPendingDelete(id: string): Promise<void>
  clearPendingDeletes(ids: string[]): Promise<void> | void
}

/**
 * After a local Sil while a cloud session exists: the id is saved to pendingDeletes first (so the next sync sends it
 * even if the app closes), then the server delete is tried in the background and clears it on success / 404.
 * Resolves once the id is saved; `sent` settles when the background attempt is over (never rejects).
 */
export async function deleteRecordingInCloud(
  songId: string,
  fileName: string,
  lib: PendingDeletes,
  makeApi: (s: Session) => Pick<ReturnType<typeof createApi>, 'deleteRecording'> = (s) => createApi(s),
): Promise<{ sent: Promise<void> }> {
  const session = getSession()
  if (!session) return { sent: Promise.resolve() }
  const id = await recordingId(songId, fileName)
  try { await lib.addPendingDelete(id) } catch { /* still try the server directly */ }
  const sent = makeApi(session)
    .deleteRecording(id)
    .then(
      () => lib.clearPendingDeletes([id]),
      (e) => { if (e instanceof CloudError && e.kind === 'gone') return lib.clearPendingDeletes([id]) },
    )
    .then(() => undefined, () => undefined)
  return { sent }
}
