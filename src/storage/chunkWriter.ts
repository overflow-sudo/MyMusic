import type { FsDir } from './fsDir'

export interface PendingMeta {
  songFolderName: string
  fileName: string
}

const PENDING = '.parcalar'
const RECORDINGS = 'recordings'
const META = 'meta.json'
const partName = (n: number) => `${String(n).padStart(6, '0')}.part`
const isPart = (name: string) => /^\d+\.part$/.test(name)

async function finalizeDir(root: FsDir, id: string, pendingDir: FsDir, dir: FsDir, meta: PendingMeta): Promise<string> {
  const parts = (await dir.list())
    .filter((e) => e.kind === 'file' && isPart(e.name))
    .map((e) => e.name)
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10))
  const rec = (await root.dir(RECORDINGS, { create: true }))!
  const song = (await rec.dir(meta.songFolderName, { create: true }))!
  // Single writable: nothing becomes visible unless every part was read and close() succeeds.
  const out = await song.createWritable(meta.fileName)
  for (const name of parts) {
    const f = await dir.readFile(name)
    if (!f) throw new Error(`Missing part ${name}`)
    await out.write(f)
  }
  await out.close()
  await pendingDir.remove(id, { recursive: true })
  return meta.fileName
}

export class ChunkWriter {
  private count = 0
  private queue: Promise<unknown> = Promise.resolve()

  private readonly root: FsDir
  private readonly id: string
  private readonly pendingDir: FsDir
  private readonly dir: FsDir
  private readonly meta: PendingMeta

  private constructor(root: FsDir, id: string, pendingDir: FsDir, dir: FsDir, meta: PendingMeta) {
    this.root = root
    this.id = id
    this.pendingDir = pendingDir
    this.dir = dir
    this.meta = meta
  }

  static async start(root: FsDir, recordingId: string, meta: PendingMeta): Promise<ChunkWriter> {
    const pendingDir = (await root.dir(PENDING, { create: true }))!
    const dir = (await pendingDir.dir(recordingId, { create: true }))!
    await dir.writeFile(META, JSON.stringify(meta))
    return new ChunkWriter(root, recordingId, pendingDir, dir, meta)
  }

  append(chunk: Blob): Promise<void> {
    const name = partName(++this.count)
    const run = this.queue.then(() => this.dir.writeFile(name, chunk))
    this.queue = run.catch(() => undefined)
    return run
  }

  async finalize(): Promise<string> {
    await this.queue
    return finalizeDir(this.root, this.id, this.pendingDir, this.dir, this.meta)
  }

  async discard(): Promise<void> {
    await this.queue
    await this.pendingDir.remove(this.id, { recursive: true })
  }
}

function parseMeta(text: string): PendingMeta | null {
  try {
    const m = JSON.parse(text)
    return m && typeof m.songFolderName === 'string' && typeof m.fileName === 'string' ? m : null
  } catch {
    return null
  }
}

export async function recoverPending(root: FsDir): Promise<string[]> {
  const pendingDir = await root.dir(PENDING)
  if (!pendingDir) return []
  const recovered: string[] = []
  for (const e of await pendingDir.list()) {
    if (e.kind !== 'directory') continue
    const dir = await pendingDir.dir(e.name)
    if (!dir) continue
    try {
      const metaFile = await dir.readFile(META)
      const hasParts = (await dir.list()).some((x) => x.kind === 'file' && isPart(x.name))
      if (!metaFile || !hasParts) {
        await pendingDir.remove(e.name, { recursive: true })
        continue
      }
      const meta = parseMeta(await metaFile.text())
      if (!meta) continue // corrupt meta: keep the data rather than delete it
      recovered.push(await finalizeDir(root, e.name, pendingDir, dir, meta))
    } catch {
      // leave this folder for a later launch; keep recovering the others
    }
  }
  return recovered
}
