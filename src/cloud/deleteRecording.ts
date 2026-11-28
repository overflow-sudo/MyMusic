import { CloudError, createApi } from './api'
import { recordingId } from './hash'
import { getSession, type Session } from './session'
import { getCloudStatus, setCloudStatus } from './status'

export interface PendingDeletes {
  addPendingDelete(id: string): Promise<void>
  clearPendingDeletes(ids: string[]): Promise<void> | void
}

export interface CloudDelete {
  /** The local delete failed: forget the queued server delete. */
  cancel(): Promise<void>
  /** The local file is gone: try the server now (background; clears the queue entry on success / 404). */
  send(): Promise<void>
}

export const UNSAVED_DELETE_NOTE = 'Silme kaydedilemedi; buluttan silme bu oturumda yeniden denenecek.'
/** Ids whose pendingDeletes save failed: kept in memory and sent by the next passes of this session. */
const unsaved = new Set<string>()
export const pendingDeleteNote = (): string | null => (unsaved.size ? UNSAVED_DELETE_NOTE : null)

/** Saved pendingDeletes plus the in-memory ones, for the sync pass. */
export function withUnsavedDeletes(lib: { getPendingDeletes(): string[]; clearPendingDeletes(ids: string[]): Promise<void> | void }) {
  return {
    getPendingDeletes: () => [...new Set([...lib.getPendingDeletes(), ...unsaved])],
    clearPendingDeletes: (ids: string[]) => {
      for (const id of ids) unsaved.delete(id)
      return lib.clearPendingDeletes(ids)
    },
  }
}

/**
 * Before a local Sil while a cloud session exists: queue the server delete (saved to pendingDeletes, or kept in
 * memory with a status note if saving fails) so it is never forgotten. Null without a session.
 */
export async function prepareCloudDelete(
  songId: string,
  fileName: string,
  lib: PendingDeletes,
  makeApi: (s: Session) => Pick<ReturnType<typeof createApi>, 'deleteRecording'> = (s) => createApi(s),
): Promise<CloudDelete | null> {
  const session = getSession()
  if (!session) return null
  const id = await recordingId(songId, fileName)
  try {
    await lib.addPendingDelete(id)
  } catch {
    unsaved.add(id)
    setCloudStatus(getCloudStatus().state, UNSAVED_DELETE_NOTE)
  }
  const clear = async () => {
    unsaved.delete(id)
    try { await lib.clearPendingDeletes([id]) } catch { /* the next pass clears it */ }
  }
  return {
    cancel: clear,
    send: () =>
      makeApi(session)
        .deleteRecording(id)
        .then(clear, (e) => { if (e instanceof CloudError && e.kind === 'gone') return clear() })
        .then(() => undefined, () => undefined),
  }
}

/** Test helper: forget in-memory deletes. */
export function resetUnsavedDeletes(): void {
  unsaved.clear()
}
