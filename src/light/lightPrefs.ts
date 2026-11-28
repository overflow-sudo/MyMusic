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

export const LIGHT_PRESETS: { hex: string; name: string }[] = [
  { hex: '#3b82f6', name: 'Mavi' },
  { hex: '#8b5cf6', name: 'Mor' },
  { hex: '#ec4899', name: 'Pembe' },
  { hex: '#ef4444', name: 'Kırmızı' },
  { hex: '#f97316', name: 'Turuncu' },
  { hex: '#eab308', name: 'Sarı' },
  { hex: '#22c55e', name: 'Yeşil' },
  { hex: '#14b8a6', name: 'Turkuaz' },
]

export type LightColor = 'auto' | string

export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)

const COLOR_KEY = 'mm.lightColor'
const colorListeners = new Set<(c: LightColor) => void>()

/** Global light color: 'auto' (tempo hue) or '#rrggbb'. Anything invalid → 'auto'. */
export function getLightColor(): LightColor {
  try {
    const v = localStorage.getItem(COLOR_KEY)
    return isHexColor(v) ? v.toLowerCase() : 'auto'
  } catch {
    return 'auto'
  }
}

export function setLightColor(c: LightColor): void {
  const v = isHexColor(c) ? c.toLowerCase() : 'auto'
  try {
    localStorage.setItem(COLOR_KEY, v)
  } catch {
    /* storage unavailable: still notify */
  }
  colorListeners.forEach((cb) => cb(v))
}

export function onLightColorChange(cb: (c: LightColor) => void): () => void {
  colorListeners.add(cb)
  return () => {
    colorListeners.delete(cb)
  }
}

/** Song color beats the global one; null = auto (tempo hue). */
export function effectiveLightColor(globalPref: LightColor, song?: { lightColor?: unknown } | null): string | null {
  if (isHexColor(song?.lightColor)) return song.lightColor
  return isHexColor(globalPref) ? globalPref : null
}
