import { withTimeout } from '../cover/itunes'
import type { Song } from '../domain/types'
import type { FsDir } from './fsDir'
import { songDir } from './repo'

const isCoverFile = (name: string) => /^cover\./i.test(name)

function safeExt(ext: string): string {
  const e = ext.toLowerCase()
  return /^[a-z0-9]{1,5}$/.test(e) ? e : 'jpg'
}

async function existingDir(root: FsDir, song: Song): Promise<FsDir | null> {
  const rec = await root.dir('recordings')
  return rec ? rec.dir(song.folderName) : null
}

export async function writeCover(root: FsDir, song: Song, data: Blob, ext: string): Promise<string> {
  const dir = await songDir(root, song)
  const fileName = `cover.${safeExt(ext)}`
  await dir.writeFile(fileName, data)
  // The new cover is saved; a stray old cover.* that can't be removed is not worth failing over.
  try {
    for (const e of await dir.list())
      if (e.kind === 'file' && isCoverFile(e.name) && e.name.toLowerCase() !== fileName) await dir.remove(e.name)
  } catch {
    /* ignore */
  }
  return fileName
}

export async function readCover(root: FsDir, song: Song): Promise<File | null> {
  const dir = await existingDir(root, song)
  if (!dir) return null
  if (song.cover?.fileName) {
    const f = await dir.readFile(song.cover.fileName)
    if (f) return f
  }
  const found = (await dir.list()).find((e) => e.kind === 'file' && isCoverFile(e.name))
  return found ? dir.readFile(found.name) : null
}

export async function removeCover(root: FsDir, song: Song): Promise<void> {
  const dir = await existingDir(root, song)
  if (!dir) return
  for (const e of await dir.list()) if (e.kind === 'file' && isCoverFile(e.name)) await dir.remove(e.name)
}

export function downloadImage(
  url: string,
  f: typeof fetch = (u, i) => fetch(u, i),
  timeoutMs?: number,
): Promise<Blob | null> {
  return withTimeout(async (signal) => {
    try {
      const res = await f(url, { signal })
      if (!res.ok) return null
      const blob = await res.blob()
      const type = res.headers?.get('content-type') ?? blob.type
      return type.startsWith('image/') ? blob : null
    } catch {
      return null
    }
  }, null, timeoutMs)
}
