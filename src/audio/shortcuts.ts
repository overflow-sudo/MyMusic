import type { SessionState } from './sessionMachine'

export function shortcutAction(
  key: string,
  state: SessionState,
  target: { tagName: string; isContentEditable?: boolean },
): 'start' | 'stop' | 'cancel' | null {
  const tag = target.tagName.toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return null
  if (key === ' ') {
    if (state === 'idle' || state === 'error') return 'start'
    if (state === 'recording') return 'stop'
    return null
  }
  if (key === 'Escape' && state === 'countingIn') return 'cancel'
  return null
}
