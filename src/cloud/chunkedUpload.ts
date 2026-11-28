import { CloudError, type CloudApi } from './api'

export const PART_BYTES = 32 * 1024 * 1024

export interface UploadOpts { onProgress?: (sentBytes: number, totalBytes: number) => void; signal?: AbortSignal }

/**
 * Uploads `blob` in 32 MiB parts, then completes with `completeBody` (must include `target`).
 * Any failure aborts the server-side upload (best effort) and rethrows; the caller restarts from part 0
 * on its next pass. Returns the complete call's JSON.
 * Errors for the caller (Task 11): a 429 from create is CloudError kind 'rate' (with retryAfter); a timeout of the
 * complete call is kind 'offline' with phase 'complete' - the server may have created the item, so verify via
 * getRecordings before re-uploading.
 */
export async function uploadBlob(
  api: CloudApi,
  blob: Blob,
  completeBody: Record<string, unknown>,
  opts: UploadOpts = {},
): Promise<Record<string, unknown>> {
  const { signal, onProgress } = opts
  const { uploadId } = await api.createUpload({ signal })
  try {
    const total = blob.size
    const count = Math.max(1, Math.ceil(total / PART_BYTES))
    let sent = 0
    for (let n = 0; n < count; n++) {
      if (signal?.aborted) throw new CloudError('client', 'Aborted')
      const part = blob.slice(n * PART_BYTES, Math.min(total, (n + 1) * PART_BYTES))
      await api.putPart(uploadId, n, part, { signal })
      sent += part.size
      onProgress?.(sent, total)
    }
    if (signal?.aborted) throw new CloudError('client', 'Aborted')
    return await api.completeUpload(uploadId, completeBody, { signal })
  } catch (e) {
    await abortBestEffort(api, uploadId)
    throw e
  }
}

export const ABORT_RETRY_MS = 2000

/** A timed-out part is usually still in flight server-side (409): retry the abort once after a short wait. */
async function abortBestEffort(api: CloudApi, uploadId: string): Promise<void> {
  try { await api.abortUpload(uploadId); return } catch (e) {
    if (!(e instanceof CloudError && e.kind === 'conflict')) return
  }
  await new Promise((r) => setTimeout(r, ABORT_RETRY_MS))
  try { await api.abortUpload(uploadId) } catch { /* best effort */ }
}
