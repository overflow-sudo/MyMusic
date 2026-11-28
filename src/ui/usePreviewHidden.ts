import { useSyncExternalStore } from 'react'

const KEY = 'mm.previewHidden'
const listeners = new Set<() => void>()
let fallback = false // when localStorage is unavailable

function read(): boolean {
  try {
    const v = localStorage.getItem(KEY)
    if (v !== null) return v === '1'
  } catch {
    /* blocked storage: use the in-memory value */
  }
  return fallback
}

export function setPreviewHidden(hidden: boolean): void {
  fallback = hidden
  try {
    localStorage.setItem(KEY, hidden ? '1' : '0')
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => void listeners.delete(l)
}

/** Device-only flag (never synced): hide the camera preview while recording video. */
export function usePreviewHidden(): [boolean, (hidden: boolean) => void] {
  return [useSyncExternalStore(subscribe, read, () => false), setPreviewHidden]
}
