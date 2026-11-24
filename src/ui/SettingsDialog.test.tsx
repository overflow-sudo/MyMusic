import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SettingsDialog from './SettingsDialog'

afterEach(cleanup)

function setup(value: number | null) {
  const onSave = vi.fn(async () => {})
  const onClose = vi.fn()
  render(<SettingsDialog value={value} onSave={onSave} onClose={onClose} measureAuto={async () => 38} />)
  return { onSave, onClose, input: screen.getByLabelText('Gecikme telafisi (ms)') }
}

describe('SettingsDialog', () => {
  it('shows the auto value; empty saves null (auto)', async () => {
    const { onSave, onClose, input } = setup(45)
    expect(input).toHaveValue(45)
    expect(await screen.findByText(/otomatik: 38 ms/)).toBeInTheDocument()
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(null))
    expect(onClose).toHaveBeenCalled()
  })

  it('saves a value in range and rejects one outside 0–500', async () => {
    const { onSave, input } = setup(null)
    await screen.findByText(/otomatik: 38 ms/)
    fireEvent.change(input, { target: { value: '600' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('0 ile 500')
    expect(onSave).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '60' } })
    fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(60))
  })
})
