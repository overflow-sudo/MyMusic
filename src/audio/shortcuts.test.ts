import { describe, it, expect } from 'vitest'
import { shortcutAction } from './shortcuts'

const body = { tagName: 'BODY' }
describe('shortcutAction', () => {
  it('space starts when idle, stops when recording', () => {
    expect(shortcutAction(' ', 'idle', body)).toBe('start')
    expect(shortcutAction(' ', 'recording', body)).toBe('stop')
  })
  it('space does nothing while counting in or finalizing', () => {
    expect(shortcutAction(' ', 'countingIn', body)).toBeNull()
    expect(shortcutAction(' ', 'finalizing', body)).toBeNull()
  })
  it('space restarts from error', () => {
    expect(shortcutAction(' ', 'error', body)).toBe('start')
  })
  it('escape cancels only during count-in', () => {
    expect(shortcutAction('Escape', 'countingIn', body)).toBe('cancel')
    for (const s of ['idle', 'recording', 'finalizing', 'error'] as const)
      expect(shortcutAction('Escape', s, body)).toBeNull()
  })
  it('ignores editable targets', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT'])
      expect(shortcutAction(' ', 'idle', { tagName })).toBeNull()
    expect(shortcutAction(' ', 'idle', { tagName: 'DIV', isContentEditable: true })).toBeNull()
    expect(shortcutAction('Escape', 'countingIn', { tagName: 'INPUT' })).toBeNull()
  })
  it('ignores other keys', () => {
    expect(shortcutAction('a', 'idle', body)).toBeNull()
  })
})
