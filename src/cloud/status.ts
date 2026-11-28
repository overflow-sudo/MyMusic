import { useSyncExternalStore } from 'react'

export type CloudState = 'off' | 'connecting' | 'connected' | 'syncing' | 'offline' | 'needs-login'
export interface CloudStatus { state: CloudState; lastError: string | null; lastSyncAt: string | null }

const initial: CloudStatus = { state: 'off', lastError: null, lastSyncAt: null }
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
