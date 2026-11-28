import type { SessionState } from './sessionMachine'

type Target = { tagName: string; isContentEditable?: boolean; closest?: (selector: string) => Element | null }

const OWN_KEYS = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'AUDIO', 'VIDEO'])

/** Elements that use Space themselves (typing, play/pause): shortcuts must leave them alone. */
export function isTypingTarget(target: Target): boolean {
  return OWN_KEYS.has(target.tagName.toUpperCase()) || !!target.isContentEditable || !!target.closest?.('[data-player]')
}

/** A [data-keeps-space] control (preview toggle) keeps Space for itself only while Space would start a take; stop/cancel still work. */
export function keepsSpace(key: string, state: SessionState, target: Target): boolean {
  return key === ' ' && (state === 'idle' || state === 'error') && !!target.closest?.('[data-keeps-space]')
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
