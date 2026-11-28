import { useSyncExternalStore } from 'react'

export type CloudState = 'off' | 'connecting' | 'connected' | 'syncing' | 'offline' | 'needs-login'
export interface CloudStatus {
  state: CloudState
  lastError: string | null
  lastSyncAt: string | null
  /** Short progress text while a pass transfers files (e.g. "Yükleniyor: 2/5"). */
  progress: string | null
}

const initial: CloudStatus = { state: 'off', lastError: null, lastSyncAt: null, progress: null }
let current = initial
const listeners = new Set<() => void>()

function set(next: CloudStatus): void {
  current = next
  for (const l of [...listeners]) l()
}

export const getCloudStatus = (): CloudStatus => current

export function setCloudStatus(state: CloudState, lastError: string | null = null): void {
  if (state === current.state && lastError === current.lastError) return
  set({ ...current, state, lastError })
}

export function setCloudProgress(progress: string | null): void {
  if (progress === current.progress) return
  set({ ...current, progress })
}

export function markSynced(at: string = new Date().toISOString()): void {
  set({ ...current, lastSyncAt: at })
}

export function resetCloudStatus(): void {
  set(initial)
}

export function subscribeCloudStatus(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

export function useCloudStatus(): CloudStatus {
  return useSyncExternalStore(subscribeCloudStatus, getCloudStatus)
}

// Counts finished sync passes (successful or not): lists that show server data refetch when it changes.
let passCount = 0
const passListeners = new Set<() => void>()
export const getPassCount = (): number => passCount
export function bumpPassCount(): void {
  passCount++
  for (const l of [...passListeners]) l()
}
export function usePassCount(): number {
  return useSyncExternalStore((fn) => { passListeners.add(fn); return () => { passListeners.delete(fn) } }, getPassCount)
}
