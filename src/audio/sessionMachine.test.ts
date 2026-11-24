import { describe, it, expect } from 'vitest'
import { nextState, type SessionState, type SessionEvent } from './sessionMachine'

describe('nextState', () => {
  const cases: [SessionState, SessionEvent, SessionState][] = [
    ['idle', 'START', 'countingIn'],
    ['countingIn', 'CANCEL', 'idle'],
    ['countingIn', 'STOP', 'idle'],
    ['countingIn', 'COUNT_DONE', 'recording'],
    ['recording', 'STOP', 'finalizing'],
    ['recording', 'TRACK_ENDED', 'finalizing'],
    ['finalizing', 'FINALIZED', 'idle'],
    ['error', 'START', 'countingIn'],
    ['idle', 'STOP', 'idle'],
    ['recording', 'START', 'recording'],
    ['finalizing', 'STOP', 'finalizing'],
    ['recording', 'CANCEL', 'recording'],
  ]
  it.each(cases)('%s + %s -> %s', (s, e, n) => expect(nextState(s, e)).toBe(n))
  it.each(['idle', 'countingIn', 'recording', 'finalizing', 'error'] as SessionState[])(
    'FAIL from %s -> error', s => expect(nextState(s, 'FAIL')).toBe('error'))
})
