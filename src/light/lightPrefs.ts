export type LightMode = 'a' | 'c' | 'off'

const KEY = 'mm.light'
const listeners = new Set<(m: LightMode) => void>()

export function getLightMode(): LightMode {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'a' || v === 'c' || v === 'off' ? v : 'a'
  } catch {
    return 'a'
  }
}

export function setLightMode(m: LightMode): void {
  try {
    localStorage.setItem(KEY, m)
  } catch {
    /* storage unavailable: still notify */
  }
  listeners.forEach((cb) => cb(m))
}

export function onLightModeChange(cb: (m: LightMode) => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
