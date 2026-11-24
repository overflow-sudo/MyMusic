export type DeviceKind = 'mic' | 'cam' | 'out'

const KEYS: Record<DeviceKind, string> = { mic: 'mm.mic', cam: 'mm.cam', out: 'mm.out' }

/** Chromium's aliases for the system default; the UI has its own "Varsayılan" entry. */
const isPseudo = (d: MediaDeviceInfo) => d.deviceId === 'default' || d.deviceId === 'communications'

export async function listDevices(): Promise<{ mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[]; outs: MediaDeviceInfo[] }> {
  const all = (await navigator.mediaDevices.enumerateDevices()).filter((d) => !isPseudo(d))
  return {
    mics: all.filter((d) => d.kind === 'audioinput'),
    cams: all.filter((d) => d.kind === 'videoinput'),
    outs: all.filter((d) => d.kind === 'audiooutput'),
  }
}

/** '' means the user explicitly chose the system default. */
export function savedDevice(kind: DeviceKind): string | undefined {
  try {
    return localStorage.getItem(KEYS[kind]) ?? undefined
  } catch {
    return undefined
  }
}

export function saveDevice(kind: DeviceKind, id: string): void {
  try {
    localStorage.setItem(KEYS[kind], id)
  } catch {
    /* storage blocked: the choice just isn't remembered */
  }
}

/** Saved output, else the M-Audio headphones output if present (spec's suggested default). */
export function suggestedOutput(outs: MediaDeviceInfo[]): string {
  const saved = savedDevice('out')
  if (saved !== undefined && saved !== 'default' && saved !== 'communications') return saved
  return outs.find((d) => !isPseudo(d) && /m-audio/i.test(d.label))?.deviceId ?? ''
}
