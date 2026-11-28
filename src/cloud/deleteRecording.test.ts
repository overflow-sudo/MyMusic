import { afterEach, describe, expect, it } from 'vitest'
import { createMemoryDir } from '../storage/memoryDir'
import { CloudError } from './api'
import { deleteRecordingInCloud } from './deleteRecording'
import { createFakeCloud } from './fakeCloud.testutil'
import { recordingId } from './hash'
import { clearSession, setSession } from './session'
import { syncRecordingsOnce } from './syncRecordings'

const NAME = '2026-11-24_21-30-05_video.webm'

function lib() {
  let pending: string[] = []
  return {
    addPendingDelete: async (id: string) => { if (!pending.includes(id)) pending = [...pending, id] },
    clearPendingDeletes: (ids: string[]) => { pending = pending.filter((x) => !ids.includes(x)) },
    getPendingDeletes: () => pending,
  }
}

afterEach(() => { clearSession(); localStorage.clear() })

describe('deleteRecordingInCloud', () => {
  it('without a session does nothing', async () => {
    const l = lib()
    await (await deleteRecordingInCloud('s1', NAME, l, () => { throw new Error('no api') })).sent
    expect(l.getPendingDeletes()).toEqual([])
  })

  it('online: deletes on the server and leaves nothing pending', async () => {
    setSession({ baseUrl: 'https://example.test', token: 'dummy-token' })
    const cloud = createFakeCloud()
    const l = lib()
    let atRequest: string[] = []
    cloud.failDelete = () => { atRequest = l.getPendingDeletes(); return undefined }
    const r = await deleteRecordingInCloud('s1', NAME, l, () => cloud.api)
    const id = await recordingId('s1', NAME)
    await r.sent
    expect(atRequest).toEqual([id]) // saved before the request
    expect(cloud.tombstones.has(id)).toBe(true)
    expect(l.getPendingDeletes()).toEqual([])
  })

  it('offline: stays in pendingDeletes and the next pass sends and clears it', async () => {
    setSession({ baseUrl: 'https://example.test', token: 'dummy-token' })
    const cloud = createFakeCloud()
    cloud.failDelete = () => new CloudError('offline', 'Network error')
    const l = lib()
    await (await deleteRecordingInCloud('s1', NAME, l, () => cloud.api)).sent
    const id = await recordingId('s1', NAME)
    expect(l.getPendingDeletes()).toEqual([id])

    cloud.failDelete = undefined
    await syncRecordingsOnce({ api: cloud.api, root: createMemoryDir(), getLocalSongs: () => [], shouldStop: () => false, ...l })
    expect(cloud.tombstones.has(id)).toBe(true)
    expect(l.getPendingDeletes()).toEqual([])
  })
})
