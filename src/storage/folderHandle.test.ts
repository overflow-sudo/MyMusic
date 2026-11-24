import { describe, expect, it, vi } from 'vitest'
import { ensurePermission } from './folderHandle'

const fake = (query: PermissionState, request: PermissionState = 'granted') => {
  const h = {
    queryPermission: vi.fn().mockResolvedValue(query),
    requestPermission: vi.fn().mockResolvedValue(request),
  }
  return { h, handle: h as unknown as FileSystemDirectoryHandle }
}
const rw = { mode: 'readwrite' }

describe('ensurePermission', () => {
  it('granted query -> true, no request', async () => {
    const { h, handle } = fake('granted')
    expect(await ensurePermission(handle, true)).toBe(true)
    expect(h.queryPermission).toHaveBeenCalledWith(rw)
    expect(h.requestPermission).not.toHaveBeenCalled()
  })
  it("'prompt' without prompting -> false and never requests", async () => {
    const { h, handle } = fake('prompt')
    expect(await ensurePermission(handle, false)).toBe(false)
    expect(h.queryPermission).toHaveBeenCalledWith(rw)
    expect(h.requestPermission).not.toHaveBeenCalled()
  })
  it('prompt=true requests and returns granted -> true', async () => {
    const { h, handle } = fake('prompt', 'granted')
    expect(await ensurePermission(handle, true)).toBe(true)
    expect(h.requestPermission).toHaveBeenCalledWith(rw)
  })
  it('prompt=true denied -> false', async () => {
    const { handle } = fake('prompt', 'denied')
    expect(await ensurePermission(handle, true)).toBe(false)
  })
})
