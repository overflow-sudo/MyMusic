import { describe, expect, it, vi } from 'vitest'
import type { CloudApi } from './api'
import { CloudError } from './api'
import { PART_BYTES, uploadBlob } from './chunkedUpload'

const MB = 1024 * 1024
function fakeApi(over: Partial<CloudApi> = {}) {
  const sizes: number[] = []
  const api = {
    createUpload: vi.fn(async () => ({ uploadId: 'u1' })),
    putPart: vi.fn(async (_id: string, n: number, body: Blob) => { sizes[n] = body.size; return { size: body.size } }),
    completeUpload: vi.fn(async (_id: string, body: Record<string, unknown>) => ({ id: 'rec', status: 'processing', ...body })),
    abortUpload: vi.fn(async () => {}),
    ...over,
  } as unknown as CloudApi
  return { api, sizes }
}

describe('uploadBlob', () => {
  it('splits 70 MB into 3 parts (32,32,6 MiB-ish) and completes', async () => {
    const { api, sizes } = fakeApi()
    const blob = new Blob([new Uint8Array(70 * MB)])
    const progress: number[] = []
    const res = await uploadBlob(api, blob, { target: 'recording', songId: 's' }, { onProgress: (sent) => progress.push(sent) })
    expect(PART_BYTES).toBe(33554432)
    expect(sizes).toEqual([PART_BYTES, PART_BYTES, 70 * MB - 2 * PART_BYTES])
    expect(api.putPart).toHaveBeenCalledTimes(3)
    expect(api.completeUpload).toHaveBeenCalledWith("u1", { target: "recording", songId: "s" }, expect.anything())
    expect(res).toMatchObject({ id: 'rec' })
    expect(progress.at(-1)).toBe(70 * MB)
    expect(api.abortUpload).not.toHaveBeenCalled()
  })

  it('an empty blob still uploads one empty part', async () => {
    const { api, sizes } = fakeApi()
    await uploadBlob(api, new Blob([]), { target: 'cover', songId: 's' })
    expect(sizes).toEqual([0])
  })

  it('failure on part 2 aborts the upload and rethrows; no retry', async () => {
    const { api } = fakeApi({
      putPart: vi.fn(async (_id: string, n: number, b: Blob) => {
        if (n === 1) throw new CloudError('offline', 'x')
        return { size: b.size }
      }),
    } as Partial<CloudApi>)
    const blob = new Blob([new Uint8Array(70 * MB)])
    await expect(uploadBlob(api, blob, { target: 'recording', songId: 's' })).rejects.toMatchObject({ kind: 'offline' })
    expect(api.putPart).toHaveBeenCalledTimes(2)
    expect(api.abortUpload).toHaveBeenCalledWith('u1')
    expect(api.completeUpload).not.toHaveBeenCalled()
  })

  it('complete failure also aborts (best effort, abort errors swallowed)', async () => {
    const { api } = fakeApi({
      completeUpload: vi.fn(async () => { throw new CloudError('gone', 'deleted', { status: 410 }) }),
      abortUpload: vi.fn(async () => { throw new CloudError('offline', 'x') }),
    } as Partial<CloudApi>)
    await expect(uploadBlob(api, new Blob(['a']), { target: 'recording', songId: 's' })).rejects.toMatchObject({ kind: 'gone' })
    expect(api.abortUpload).toHaveBeenCalled()
  })

  it('create failure does not try to abort', async () => {
    const { api } = fakeApi({ createUpload: vi.fn(async () => { throw new CloudError('rate', 'x') }) } as Partial<CloudApi>)
    await expect(uploadBlob(api, new Blob(['a']), { target: 'track', songId: 's' })).rejects.toMatchObject({ kind: 'rate' })
    expect(api.abortUpload).not.toHaveBeenCalled()
  })

  it('stops between parts when the signal aborts', async () => {
    const ac = new AbortController()
    const { api } = fakeApi({
      putPart: vi.fn(async (_i: string, _n: number, b: Blob) => { ac.abort(); return { size: b.size } }),
    } as Partial<CloudApi>)
    await expect(uploadBlob(api, new Blob([new Uint8Array(40 * MB)]), { target: 'track', songId: 's' }, { signal: ac.signal })).rejects.toBeInstanceOf(CloudError)
    expect(api.putPart).toHaveBeenCalledTimes(1)
    expect(api.abortUpload).toHaveBeenCalled()
  })
})

describe('uploadBlob abort retry and rate', () => {
  it('retries abort once after 2 s on conflict', async () => {
    vi.useFakeTimers()
    let n = 0
    const { api } = fakeApi({
      putPart: vi.fn(async () => { throw new CloudError('offline', 'timeout') }),
      abortUpload: vi.fn(async () => { if (n++ === 0) throw new CloudError('conflict', 'in flight', { status: 409 }) }),
    } as Partial<CloudApi>)
    const p = uploadBlob(api, new Blob(['a']), { target: 'track', songId: 's' }).catch((x) => x)
    await vi.advanceTimersByTimeAsync(2100)
    expect((await p).kind).toBe('offline')
    expect(api.abortUpload).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })
  it('429 on create surfaces as rate with retryAfter', async () => {
    const { api } = fakeApi({ createUpload: vi.fn(async () => { throw new CloudError('rate', 'x', { retryAfter: 60 }) }) } as Partial<CloudApi>)
    await expect(uploadBlob(api, new Blob(['a']), { target: 'track', songId: 's' })).rejects.toMatchObject({ kind: 'rate', retryAfter: 60 })
  })
})
