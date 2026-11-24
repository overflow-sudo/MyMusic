import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BrokenLibrary from './BrokenLibrary'

afterEach(cleanup)

describe('BrokenLibrary', () => {
  it('shows a Turkish message when backup fails', async () => {
    const onReset = vi.fn(async () => {
      throw new Error('disk')
    })
    render(<BrokenLibrary error="bozuk" onReset={onReset} />)
    fireEvent.click(screen.getByRole('button', { name: 'Yedekle ve yeni liste başlat' }))
    expect(await screen.findByText('Yedekleme başarısız oldu, tekrar dene.')).toBeInTheDocument()
    expect(onReset).toHaveBeenCalledTimes(1)
  })
})
