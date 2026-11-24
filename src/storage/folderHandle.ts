import { get, set } from 'idb-keyval'

const KEY = 'rootHandle'

export async function getSavedHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return (await get<FileSystemDirectoryHandle>(KEY)) ?? null
  } catch {
    return null
  }
}

export async function saveHandle(h: FileSystemDirectoryHandle): Promise<void> {
  await set(KEY, h)
}

export async function pickFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return null
    throw e
  }
}

// prompt=false only queries; prompt=true may show the browser prompt (needs a user click).
export async function ensurePermission(h: FileSystemDirectoryHandle, prompt: boolean): Promise<boolean> {
  const opts = { mode: 'readwrite' } as const
  if ((await h.queryPermission(opts)) === 'granted') return true
  if (!prompt) return false
  return (await h.requestPermission(opts)) === 'granted'
}
