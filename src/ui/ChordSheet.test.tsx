import '@testing-library/jest-dom/vitest'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ChordSheet } from './ChordSheet'

describe('ChordSheet', () => {
  it('wraps chord tokens and keeps spacing', () => {
    const { container } = render(<ChordSheet text={'Am  G  C\nHello world'} />)
    const chords = [...container.querySelectorAll('.chord')].map((e) => e.textContent)
    expect(chords).toEqual(['Am', 'G', 'C'])
    expect(container.querySelector('.chord-line')?.textContent).toBe('Am  G  C')
    expect(container.textContent).toContain('Hello world')
  })
  it('renders inline chords and sections', () => {
    const { container } = render(<ChordSheet text={'[Verse]\n[Am]Hello [G]world'} />)
    expect(container.querySelector('.chord-section')?.textContent).toBe('Verse')
    expect([...container.querySelectorAll('.chord')].map((e) => e.textContent)).toEqual(['Am', 'G'])
  })
  it('does not mark lyrics as chords', () => {
    const { container } = render(<ChordSheet text="A day in the life" />)
    expect(container.querySelector('.chord')).toBeNull()
  })
  it('applies size class', () => {
    const { container } = render(<ChordSheet text="Am" size="lg" />)
    expect(container.firstElementChild).toHaveClass('chord-sheet', 'lg')
  })
})
