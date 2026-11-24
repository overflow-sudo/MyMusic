import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createMemoryDir } from './storage/memoryDir'

vi.mock('./storage/folderHandle', () => ({
  getSavedHandle: async () => ({ getDirectoryHandle: async () => ({}) }),
  ensurePermission: async () => true,
  pickFolder: vi.fn(),
  saveHandle: vi.fn(),
}))
vi.mock('./storage/fsDir', () => ({ fromHandle: () => memory }))
vi.mock('./storage/chunkWriter', () => ({ recoverPending: async () => [] }))

import App from './App'

let memory = createMemoryDir()

beforeEach(() => {
  memory = createMemoryDir()
  localStorage.clear()
  Object.defineProperty(window, 'showDirectoryPicker', { configurable: true, value: vi.fn() })
})
afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'showDirectoryPicker')
})

describe('App', () => {
  it('the song list is inert while the settings dialog is open', async () => {
    render(<App />)
    const gear = await screen.findByRole('button', { name: 'Ayarlar' })
    const wrapper = gear.closest('main')!.parentElement!
    expect(wrapper).not.toHaveAttribute('inert')
    fireEvent.click(gear)
    expect(wrapper).toHaveAttribute('inert')
    fireEvent.click(screen.getByRole('button', { name: 'Vazgeç' }))
    expect(wrapper).not.toHaveAttribute('inert')
  })
})
