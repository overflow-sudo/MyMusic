import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSong } from '../domain/library'
import { createMemoryDir } from '../storage/memoryDir'
import { songDir } from '../storage/repo'
import CoverArt from './CoverArt'

const urlApi = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL }
afterEach(() => {
  cleanup()
  Object.assign(URL, urlApi)
})

const song = createSong({ title: 'ışık', artist: 'Biri', status: 'learning', bpm: 90, countInBeats: 4 }, new Date(), 's1')

describe('CoverArt', () => {
  it('placeholder shows the first letter, hidden from screen readers', () => {
    const { container } = render(<CoverArt root={createMemoryDir()} song={song} size={40} />)
    const letter = container.querySelector('.cover-letter')!
    expect(letter).toHaveTextContent('I')
    expect(letter).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('img')).toBeNull()
  })

  it('a file cover shows a decorative <img> with an object URL, revoked on change and unmount', async () => {
    const root = createMemoryDir()
    const withCover = { ...song, cover: { source: 'user' as const, fileName: 'cover.png' } }
    await (await songDir(root, withCover)).writeFile('cover.png', new Blob(['x']))
    let n = 0
    URL.createObjectURL = vi.fn(() => `blob:cover-${++n}`)
    URL.revokeObjectURL = vi.fn()
    const { container, rerender, unmount } = render(<CoverArt root={root} song={withCover} size={40} />)
    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', 'blob:cover-1'))
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
    rerender(<CoverArt root={root} song={{ ...withCover, cover: { ...withCover.cover } }} size={40} />)
    await waitFor(() => expect(container.querySelector('img')).toHaveAttribute('src', 'blob:cover-2'))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cover-1')
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cover-2')
  })

  it('a remote cover uses its url; removing the cover shows the placeholder again', () => {
    const remote = { ...song, cover: { source: 'itunes' as const, url: 'https://x/600x600bb.jpg' } }
    const { container, rerender } = render(<CoverArt root={createMemoryDir()} song={remote} size={96} />)
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://x/600x600bb.jpg')
    rerender(<CoverArt root={createMemoryDir()} song={{ ...remote, cover: undefined }} size={96} />)
    expect(container.querySelector('img')).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
  })
})
