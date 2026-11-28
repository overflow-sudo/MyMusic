import type { SessionState } from './sessionMachine'

type Target = { tagName: string; isContentEditable?: boolean; closest?: (selector: string) => Element | null }

const OWN_KEYS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'AUDIO', 'VIDEO'])

/** Elements that use Space themselves (typing, play/pause): shortcuts must leave them alone. */
export function isTypingTarget(target: Target): boolean {
  return OWN_KEYS.has(target.tagName.toUpperCase()) || !!target.isContentEditable || !!target.closest?.('[data-player]')
}

const ACTIVATABLE = 'button, a[href], summary, [role="button"], [role="switch"], [role="tab"], [data-keeps-space]'

/** While Space would start a take, a focused control (button, link, ...) keeps it to activate itself natively (the record button starts via its own click). Stop/cancel still work from anywhere. */
export function keepsSpace(key: string, state: SessionState, target: Target): boolean {
  return key === ' ' && (state === 'idle' || state === 'error') && !!target.closest?.(ACTIVATABLE)
}

export function shortcutAction(key: string, state: SessionState, target: Target): 'start' | 'stop' | 'cancel' | null {
  if (isTypingTarget(target) || keepsSpace(key, state, target)) return null
  if (key === ' ') {
    if (state === 'idle' || state === 'error') return 'start'
    if (state === 'recording') return 'stop'
    return null
  }
  if (key === 'Escape' && state === 'countingIn') return 'cancel'
  return null
}
