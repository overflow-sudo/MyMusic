import { describe, it, expect } from 'vitest'
import { isTypingTarget, shortcutAction } from './shortcuts'

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
  it('ignores media elements, which use Space for play/pause', () => {
    for (const tagName of ['AUDIO', 'VIDEO', 'audio']) {
      expect(isTypingTarget({ tagName })).toBe(true)
      expect(shortcutAction(' ', 'idle', { tagName })).toBeNull()
      expect(shortcutAction(' ', 'recording', { tagName })).toBeNull()
    }
    expect(isTypingTarget(body)).toBe(false)
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false)
  })
  it('ignores anything inside a [data-player]', () => {
    const wrap = document.createElement('div')
    wrap.setAttribute('data-player', '')
    const btn = document.createElement('button')
    wrap.appendChild(btn)
    expect(isTypingTarget(btn)).toBe(true)
    expect(shortcutAction(' ', 'idle', btn)).toBeNull()
    expect(isTypingTarget(document.createElement('button'))).toBe(false)
  })
  it('ignores anything marked data-keeps-space', () => {
    const btn = document.createElement('button')
    btn.setAttribute('data-keeps-space', '')
    expect(shortcutAction(' ', 'idle', btn)).toBeNull()
    expect(shortcutAction(' ', 'error', btn)).toBeNull()
    expect(shortcutAction(' ', 'recording', btn)).toBe('stop')
    expect(shortcutAction('Escape', 'countingIn', btn)).toBe('cancel')
  })
  it('ignores other keys', () => {
    expect(shortcutAction('a', 'idle', body)).toBeNull()
  })
})
