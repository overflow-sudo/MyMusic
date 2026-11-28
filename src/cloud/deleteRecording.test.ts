import { afterEach, describe, expect, it } from 'vitest'
import { createMemoryDir } from '../storage/memoryDir'
import { CloudError } from './api'
import { UNSAVED_DELETE_NOTE, pendingDeleteNote, prepareCloudDelete, resetUnsavedDeletes, withUnsavedDeletes } from './deleteRecording'
import { createFakeCloud } from './fakeCloud.testutil'
import { recordingId } from './hash'
import { clearSession, setSession } from './session'
import { getCloudStatus, resetCloudStatus } from './status'
import { syncRecordingsOnce } from './syncRecordings'

const NAME = '2026-11-24_21-30-05_video.webm'

function lib(opts: { failSave?: boolean } = {}) {
  let pending: string[] = []
  return {
    addPendingDelete: async (id: string) => {
      if (opts.failSave) throw new Error('disk')
      if (!pending.includes(id)) pending = [...pending, id]
    },
    clearPendingDeletes: (ids: string[]) => { pending = pending.filter((x) => !ids.includes(x)) },
    getPendingDeletes: () => pending,
  }
}
const login = () => setSession({ baseUrl: 'https://example.test', token: 'dummy-token' })

afterEach(() => { clearSession(); localStorage.clear(); resetUnsavedDeletes(); resetCloudStatus() })

describe('prepareCloudDelete', () => {
  it('without a session does nothing', async () => {
    const l = lib()
    expect(await prepareCloudDelete('s1', NAME, l, () => { throw new Error('no api') })).toBeNull()
    expect(l.getPendingDeletes()).toEqual([])
  })

  it('online: queued (saved) before the request, cleared after it', async () => {
    login()
    const cloud = createFakeCloud()
    const l = lib()
    const op = (await prepareCloudDelete('s1', NAME, l, () => cloud.api))!
    const id = await recordingId('s1', NAME)
    expect(l.getPendingDeletes()).toEqual([id])
    expect(cloud.log).toEqual([])
    await op.send()
    expect(cloud.tombstones.has(id)).toBe(true)
    expect(l.getPendingDeletes()).toEqual([])
  })

  it('cancel (local delete failed) forgets it', async () => {
    login()
    const l = lib()
    const op = (await prepareCloudDelete('s1', NAME, l, () => createFakeCloud().api))!
    await op.cancel()
    expect(l.getPendingDeletes()).toEqual([])
  })

  it('offline: stays in pendingDeletes and the next pass sends and clears it', async () => {
    login()
    const cloud = createFakeCloud()
    cloud.failDelete = () => new CloudError('offline', 'Network error')
    const l = lib()
    await (await prepareCloudDelete('s1', NAME, l, () => cloud.api))!.send()
    const id = await recordingId('s1', NAME)
    expect(l.getPendingDeletes()).toEqual([id])

    cloud.failDelete = undefined
    await syncRecordingsOnce({ api: cloud.api, root: createMemoryDir(), getLocalSongs: () => [], shouldStop: () => false, ...l })
    expect(cloud.tombstones.has(id)).toBe(true)
    expect(l.getPendingDeletes()).toEqual([])
  })

  it('a failed save keeps the id in memory with a status note; the next pass sends it and clears the note', async () => {
    login()
    const cloud = createFakeCloud()
    cloud.failDelete = () => new CloudError('offline', 'Network error')
    const l = lib({ failSave: true })
    await (await prepareCloudDelete('s1', NAME, l, () => cloud.api))!.send()
    const id = await recordingId('s1', NAME)
    expect(getCloudStatus().lastError).toBe(UNSAVED_DELETE_NOTE)
    const merged = withUnsavedDeletes(l)
    expect(merged.getPendingDeletes()).toEqual([id])

    cloud.failDelete = undefined
    await syncRecordingsOnce({ api: cloud.api, root: createMemoryDir(), getLocalSongs: () => [], shouldStop: () => false, ...merged })
    expect(cloud.tombstones.has(id)).toBe(true)
    expect(merged.getPendingDeletes()).toEqual([])
    expect(pendingDeleteNote()).toBeNull()
  })
})
