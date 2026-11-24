import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import Player from './Player'
import { measureDuration } from './measureDuration'

vi.mock('./measureDuration', () => ({ measureDuration: vi.fn() }))
import * as coordinator from './mediaCoordinator'

let duration = 100
let current = 0
let paused = true

beforeEach(() => {
  duration = 100
  current = 0
  paused = true
  vi.spyOn(HTMLMediaElement.prototype, 'duration', 'get').mockImplementation(() => duration)
  vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'get').mockImplementation(() => current)
  vi.spyOn(HTMLMediaElement.prototype, 'currentTime', 'set').mockImplementation((v) => {
    current = v
  })
  vi.spyOn(HTMLMediaElement.prototype, 'paused', 'get').mockImplementation(() => paused)
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(function (this: HTMLMediaElement) {
    paused = false
    this.dispatchEvent(new Event('play'))
    return Promise.resolve()
  })
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(function (this: HTMLMediaElement) {
    paused = true
    this.dispatchEvent(new Event('pause'))
  })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const media = (c: HTMLElement) => c.querySelector('audio, video') as HTMLMediaElement
const loaded = (el: HTMLMediaElement) => fireEvent.loadedMetadata(el)

describe('Player', () => {
  it('+5 and -5 move the position and clamp at 0', () => {
    const { container } = render(<Player src="blob:x" kind="audio" />)
    loaded(media(container))
    current = 3
    fireEvent.click(screen.getByRole('button', { name: '5 saniye ileri' }))
    expect(current).toBe(8)
    current = 3
    fireEvent.click(screen.getByRole('button', { name: '5 saniye geri' }))
    expect(current).toBe(0)
  })

  it('seeking beyond the duration clamps to it, and the range seeks', () => {
    const { container } = render(<Player src="blob:x" kind="audio" />)
    loaded(media(container))
    current = 98
    fireEvent.click(screen.getByRole('button', { name: '5 saniye ileri' }))
    expect(current).toBe(100)
    fireEvent.change(screen.getByRole('slider', { name: 'Konum' }), { target: { value: '42' } })
    expect(current).toBe(42)
    expect(screen.getByText('0:42 / 1:40')).toBeInTheDocument()
  })

  it('Infinity duration is measured on a detached element; the live one is never seeked', async () => {
    duration = Infinity
    vi.mocked(measureDuration).mockResolvedValue(125)
    const { container } = render(<Player src="blob:x" kind="audio" />)
    loaded(media(container))
    expect(measureDuration).toHaveBeenCalledWith('blob:x', 'ses')
    expect(current).toBe(0)
    expect(await screen.findByText('0:00 / 2:05')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '5 saniye ileri' }))
    expect(current).toBe(5)
    expect(screen.getByRole('slider', { name: 'Konum' })).toHaveAttribute('aria-valuetext', '0:05 / 2:05')
  })

  it('autoPlay + Infinity duration keeps playing and resolves the total', async () => {
    duration = Infinity
    vi.mocked(measureDuration).mockResolvedValue(61)
    const { container } = render(<Player src="blob:x" kind="video" autoPlay />)
    const el = media(container)
    expect(el.autoplay).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Oynat' }))
    loaded(el)
    expect(paused).toBe(false)
    expect(current).toBe(0)
    expect(await screen.findByText('0:00 / 1:01')).toBeInTheDocument()
    expect(paused).toBe(false)
    expect(screen.getByRole('button', { name: 'Duraklat' })).toBeInTheDocument()
  })

  it('play claims playback; the button toggles to Duraklat; unmount unregisters', () => {
    const claim = vi.spyOn(coordinator, 'claimPlayback')
    const { container, unmount } = render(<Player src="blob:x" kind="audio" />)
    fireEvent.click(screen.getByRole('button', { name: 'Oynat' }))
    expect(claim).toHaveBeenCalledWith(media(container))
    expect(screen.getByRole('button', { name: 'Duraklat' })).toBeInTheDocument()
    unmount()
    const other = document.createElement('audio')
    const pause = vi.spyOn(other, 'pause')
    const off = coordinator.register(other)
    coordinator.pauseAll()
    expect(pause).toHaveBeenCalled()
    off()
  })

  it('two players: starting one pauses the other', () => {
    const a = render(<Player src="blob:a" kind="audio" />)
    const b = render(<Player src="blob:b" kind="audio" />)
    const pause = vi.spyOn(media(a.container), 'pause')
    act(() => {
      fireEvent(media(b.container), new Event('play'))
    })
    expect(pause).toHaveBeenCalled()
  })

  it('Space on the range toggles playback', () => {
    render(<Player src="blob:x" kind="audio" />)
    const range = screen.getByRole('slider', { name: 'Konum' })
    expect(fireEvent.keyDown(range, { key: ' ' })).toBe(false)
    expect(paused).toBe(false)
  })

  it('has data-player, renders extra, and video kind has no native controls', () => {
    const { container } = render(<Player src="blob:x" kind="video" extra={<button>Buradan başla</button>} />)
    expect(container.querySelector('[data-player]')).not.toBeNull()
    expect(media(container).tagName).toBe('VIDEO')
    expect(media(container).hasAttribute('controls')).toBe(false)
    expect(screen.getByText('Buradan başla')).toBeInTheDocument()
  })
})
