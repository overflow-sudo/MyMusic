import { describe, it, expect, vi } from 'vitest'
import { claimPlayback, pauseAll, register } from './mediaCoordinator'

const fake = () => ({ pause: vi.fn() }) as unknown as HTMLMediaElement & { pause: ReturnType<typeof vi.fn> }

describe('mediaCoordinator', () => {
  it('claimPlayback pauses the others but not the claimer', () => {
    const a = fake()
    const b = fake()
    register(a)
    register(b)
    claimPlayback(a)
    expect(b.pause).toHaveBeenCalledTimes(1)
    expect(a.pause).not.toHaveBeenCalled()
  })
  it('pauseAll pauses every registered element; unregistered ones are left alone', () => {
    const a = fake()
    const b = fake()
    const off = register(a)
    register(b)
    off()
    pauseAll()
    expect(a.pause).not.toHaveBeenCalled()
    expect(b.pause).toHaveBeenCalledTimes(1)
  })
})
