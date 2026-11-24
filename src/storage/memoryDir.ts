import type { FsDir } from './fsDir'

export function createMemoryDir(): FsDir {
  const files = new Map<string, File>()
  const dirs = new Map<string, FsDir>()
  const self: FsDir = {
    async dir(name, opts) {
      let d = dirs.get(name)
      if (!d && opts?.create) {
        d = createMemoryDir()
        dirs.set(name, d)
      }
      return d ?? null
    },
    async readFile(name) {
      return files.get(name) ?? null
    },
    async writeFile(name, data) {
      files.set(name, new File([data], name))
    },
    async list() {
      return [
        ...[...files.keys()].map((name) => ({ name, kind: 'file' as const })),
        ...[...dirs.keys()].map((name) => ({ name, kind: 'directory' as const })),
      ]
    },
    async remove(name) {
      files.delete(name)
      dirs.delete(name)
    },
    async createWritable(name) {
      const parts: Blob[] = []
      return {
        async write(b) {
          parts.push(b)
        },
        async close() {
          files.set(name, new File(parts, name))
        },
      }
    },
  }
  return self
}
