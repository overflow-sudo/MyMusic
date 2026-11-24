export interface FsDir {
  dir(name: string, opts?: { create?: boolean }): Promise<FsDir | null>
  readFile(name: string): Promise<File | null>
  writeFile(name: string, data: Blob | string): Promise<void> // atomic via createWritable/close
  list(): Promise<{ name: string; kind: 'file' | 'directory' }[]>
  remove(name: string, opts?: { recursive?: boolean }): Promise<void>
  createWritable(name: string): Promise<{ write(b: Blob): Promise<void>; close(): Promise<void> }>
}

const isNotFound = (e: unknown) => e instanceof DOMException && e.name === 'NotFoundError'

export function fromHandle(handle: FileSystemDirectoryHandle): FsDir {
  const self: FsDir = {
    async dir(name, opts) {
      try {
        return fromHandle(await handle.getDirectoryHandle(name, { create: opts?.create ?? false }))
      } catch (e) {
        if (isNotFound(e)) return null
        throw e
      }
    },
    async readFile(name) {
      try {
        return await (await handle.getFileHandle(name)).getFile()
      } catch (e) {
        if (isNotFound(e)) return null
        throw e
      }
    },
    async writeFile(name, data) {
      const w = await self.createWritable(name)
      await w.write(typeof data === 'string' ? new Blob([data]) : data)
      await w.close()
    },
    async list() {
      const out: { name: string; kind: 'file' | 'directory' }[] = []
      for await (const [name, h] of handle.entries()) out.push({ name, kind: h.kind })
      return out
    },
    async remove(name, opts) {
      try {
        await handle.removeEntry(name, { recursive: opts?.recursive ?? false })
      } catch (e) {
        if (!isNotFound(e)) throw e
      }
    },
    async createWritable(name) {
      const w = await (await handle.getFileHandle(name, { create: true })).createWritable()
      return { write: (b) => w.write(b), close: () => w.close() }
    },
  }
  return self
}
