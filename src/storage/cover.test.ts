import { describe, expect, it } from 'vitest'
import { createMemoryDir } from './memoryDir'
import { readCover, removeCover, writeCover } from './cover'
import { songDir } from './repo'
import { createSong } from '../domain/library'

const song = () =>
  createSong({ title: 'Wonderwall', artist: 'Oasis', status: 'learning', bpm: 87, countInBeats: 4 }, new Date(2026, 10, 24))
const names = async (root: ReturnType<typeof createMemoryDir>, s = song()) =>
  (await (await songDir(root, s)).list()).map((e) => e.name)

describe('cover storage', () => {
  it('keeps only one cover file (case-insensitive)', async () => {
    const root = createMemoryDir()
    const s = song()
    expect(await writeCover(root, s, new Blob(['a']), 'jpg')).toBe('cover.jpg')
    expect(await writeCover(root, s, new Blob(['b']), 'PNG')).toBe('cover.png')
    expect((await names(root, s)).filter((n) => n.startsWith('cover.'))).toEqual(['cover.png'])
    expect((await readCover(root, s))?.name).toBe('cover.png')
  })
  it('sanitizes bad extensions to jpg', async () => {
    const root = createMemoryDir()
    expect(await writeCover(root, song(), new Blob(['a']), '../x y')).toBe('cover.jpg')
    expect(await writeCover(root, song(), new Blob(['a']), 'toolongext')).toBe('cover.jpg')
  })
  it('does not touch track files or recordings', async () => {
    const root = createMemoryDir()
    const s = song()
    const dir = await songDir(root, s)
    await dir.writeFile('track.mp3', 'x')
    await writeCover(root, s, new Blob(['a']), 'jpg')
    await removeCover(root, s)
    expect(await names(root, s)).toEqual(['track.mp3'])
  })
  it('readCover returns null when missing, even without folder', async () => {
    expect(await readCover(createMemoryDir(), song())).toBeNull()
    const root = createMemoryDir()
    await songDir(root, song())
    expect(await readCover(root, song())).toBeNull()
  })
  it('removeCover is safe without folder', async () => {
    await expect(removeCover(createMemoryDir(), song())).resolves.toBeUndefined()
  })
  it('writeCover resolves when removing a stray old cover fails after saving', async () => {
    const root = createMemoryDir()
    const s = song()
    await writeCover(root, s, new Blob(['a']), 'png')
    const dir = await songDir(root, s)
    dir.remove = async () => {
      throw new Error('locked')
    }
    await expect(writeCover(root, s, new Blob(['b']), 'jpg')).resolves.toBe('cover.jpg')
    expect(await (await dir.readFile('cover.jpg'))?.text()).toBe('b')
  })
})
