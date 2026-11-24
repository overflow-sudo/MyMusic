import { beforeEach, describe, expect, it, vi } from 'vitest'
import { listDevices, resolveOutputDevice, saveDevice, suggestedOutput } from './devices'

const dev = (kind: MediaDeviceKind, deviceId: string, label: string) => ({ kind, deviceId, label, groupId: '' }) as MediaDeviceInfo

beforeEach(() => localStorage.clear())

describe('devices', () => {
  const outs = [
    dev('audiooutput', 'default', 'Default - Speakers (M-Audio M-Track Solo)'),
    dev('audiooutput', 'communications', 'Communications - Speakers (M-Audio M-Track Solo)'),
    dev('audiooutput', 'vm', 'Voicemeeter Input'),
    dev('audiooutput', 'ma', 'Speakers (M-Audio M-Track Solo)'),
  ]

  it('suggestedOutput never returns the Chromium pseudo-devices', () => {
    expect(suggestedOutput(outs)).toBe('ma')
    expect(suggestedOutput(outs.slice(0, 3))).toBe('')
    saveDevice('out', 'default')
    expect(suggestedOutput(outs)).toBe('ma')
    saveDevice('out', 'vm')
    expect(suggestedOutput(outs)).toBe('vm')
  })

  it('listDevices drops default/communications entries', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { enumerateDevices: vi.fn(async () => [...outs, dev('audioinput', 'default', 'Default'), dev('audioinput', 'b1', 'Voicemeeter Out B1')]) },
    })
    const d = await listDevices()
    expect(d.outs.map((x) => x.deviceId)).toEqual(['vm', 'ma'])
    expect(d.mics.map((x) => x.deviceId)).toEqual(['b1'])
  })

  it('resolveOutputDevice matches what a take uses: saved, else M-Audio, else default', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { enumerateDevices: vi.fn(async () => outs) },
    })
    expect(await resolveOutputDevice()).toBe('ma')
    saveDevice('out', 'vm')
    expect(await resolveOutputDevice()).toBe('vm')
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { enumerateDevices: vi.fn(async () => { throw new Error('x') }) },
    })
    saveDevice('out', 'vm')
    expect(await resolveOutputDevice()).toBe('vm')
  })
})
