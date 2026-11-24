import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Drawer from './Drawer'

afterEach(cleanup)

function Harness() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)}>aç</button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Panel">
        <input aria-label="ilk" />
        <button>ikinci</button>
      </Drawer>
    </>
  )
}

describe('Drawer', () => {
  it('is a hidden dialog until opened; focuses its first control; Esc closes and restores focus', () => {
    render(<Harness />)
    expect(screen.queryByRole('dialog')).toBeNull()
    const opener = screen.getByRole('button', { name: 'aç' })
    opener.focus()
    fireEvent.click(opener)
    expect(screen.getByRole('dialog', { name: 'Panel' })).toBeInTheDocument()
    expect(screen.getByLabelText('ilk')).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(opener).toHaveFocus()
  })

  it('keeps children mounted while closed', () => {
    render(<Harness />)
    expect(screen.getByLabelText('ilk')).toBeInTheDocument()
  })

  it('close button closes', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'aç' }))
    fireEvent.click(screen.getByRole('button', { name: 'Kapat' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Esc does nothing while closed', () => {
    render(<Harness />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('closing pauses any audio/video playing inside it', () => {
    function MediaHarness() {
      const [open, setOpen] = useState(true)
      return (
        <Drawer open={open} onClose={() => setOpen(false)} title="Panel">
          <audio data-testid="a" />
          <video data-testid="v" />
        </Drawer>
      )
    }
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
    render(<MediaHarness />)
    expect(pause).not.toHaveBeenCalled()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(pause).toHaveBeenCalledTimes(2)
    pause.mockRestore()
  })
})
