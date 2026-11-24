export type SessionState = 'idle' | 'countingIn' | 'recording' | 'finalizing' | 'error'
export type SessionEvent =
  | 'START' | 'COUNT_DONE' | 'STOP' | 'CANCEL' | 'TRACK_ENDED' | 'FINALIZED' | 'FAIL'

const table: Partial<Record<SessionState, Partial<Record<SessionEvent, SessionState>>>> = {
  idle: { START: 'countingIn' },
  countingIn: { COUNT_DONE: 'recording', CANCEL: 'idle', STOP: 'idle' },
  recording: { STOP: 'finalizing', TRACK_ENDED: 'finalizing' },
  finalizing: { FINALIZED: 'idle' },
  error: { START: 'countingIn' },
}

export function nextState(s: SessionState, e: SessionEvent): SessionState {
  if (e === 'FAIL') return 'error'
  return table[s]?.[e] ?? s
}
