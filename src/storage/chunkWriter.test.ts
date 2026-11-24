import { describe, expect, it } from 'vitest'
import { createMemoryDir } from './memoryDir'
import { ChunkWriter, recoverPending } from './chunkWriter'

const meta = { songFolderName: 'my-song', fileName: '2026-11-24_10-00-00_ses.webm' }
const readOut = async (root: ReturnType<typeof createMemoryDir>, name = meta.fileName) => {
  const rec = await root.dir('recordings')
  const song = await rec?.dir(meta.songFolderName)
  return (await song?.readFile(name))?.text() ?? null
}
const pending = async (root: ReturnType<typeof createMemoryDir>) =>
  (await (await root.dir('.parcalar'))?.list()) ?? []

describe('ChunkWriter', () => {
  it('concatenates un-awaited appends in order and cleans up', async () => {
    const root = createMemoryDir()
    const w = await ChunkWriter.start(root, 'r1', meta)
    const ps = [w.append(new Blob(['a'])), w.append(new Blob(['b'])), w.append(new Blob(['c']))]
    await Promise.all(ps)
    expect(await w.finalize()).toBe(meta.fileName)
    expect(await readOut(root)).toBe('abc')
    expect(await pending(root)).toEqual([])
  })

  it('orders 12 parts numerically', async () => {
    const root = createMemoryDir()
    const w = await ChunkWriter.start(root, 'r1', meta)
    const letters = 'abcdefghijkl'
    await Promise.all([...letters].map((c) => w.append(new Blob([c]))))
    await w.finalize()
    expect(await readOut(root)).toBe(letters)
  })

  it('discard leaves no output', async () => {
    const root = createMemoryDir()
    const w = await ChunkWriter.start(root, 'r1', meta)
    await w.append(new Blob(['a']))
    await w.discard()
    expect(await readOut(root)).toBeNull()
    expect(await pending(root)).toEqual([])
  })

  it('recovers an abandoned writer', async () => {
    const root = createMemoryDir()
    const w = await ChunkWriter.start(root, 'r1', meta)
    await w.append(new Blob(['x']))
    await w.append(new Blob(['y']))
    expect(await recoverPending(root)).toEqual([meta.fileName])
    expect(await readOut(root)).toBe('xy')
    expect(await pending(root)).toEqual([])
  })

  it('cleans up empty and meta-less folders without reporting them', async () => {
    const root = createMemoryDir()
    await ChunkWriter.start(root, 'empty', meta)
    const orphan = await (await root.dir('.parcalar', { create: true }))!.dir('nometa', { create: true })
    await orphan!.writeFile('000001.part', 'zzz')
    expect(await recoverPending(root)).toEqual([])
    expect(await pending(root)).toEqual([])
  })

  it('recoverPending with no .parcalar returns []', async () => {
    expect(await recoverPending(createMemoryDir())).toEqual([])
  })
})
