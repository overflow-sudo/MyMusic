import type { SessionState } from './sessionMachine'

type Target = { tagName: string; isContentEditable?: boolean; closest?: (selector: string) => Element | null }

const OWN_KEYS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'AUDIO', 'VIDEO'])

/** Elements that use Space themselves (typing, play/pause): shortcuts must leave them alone. */
export function isTypingTarget(target: Target): boolean {
  return OWN_KEYS.has(target.tagName.toUpperCase()) || !!target.isContentEditable || !!target.closest?.('[data-player], [data-keeps-space]')
}

export function shortcutAction(key: string, state: SessionState, target: Target): 'start' | 'stop' | 'cancel' | null {
  if (isTypingTarget(target)) return null
  if (key === ' ') {
    if (state === 'idle' || state === 'error') return 'start'
    if (state === 'recording') return 'stop'
    return null
  }
  if (key === 'Escape' && state === 'countingIn') return 'cancel'
  return null
}
