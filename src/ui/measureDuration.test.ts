import { afterEach, describe, expect, it, vi } from 'vitest'
import { measureDuration } from './measureDuration'

afterEach(() => vi.useRealTimers())

describe('measureDuration', () => {
  it('resolves null after the timeout when the media never loads', async () => {
    vi.useFakeTimers()
    const result = vi.fn()
    void measureDuration('blob:never', 'ses').then(result)
    await vi.advanceTimersByTimeAsync(4900)
    expect(result).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(result).toHaveBeenCalledWith(null)
  })
})
