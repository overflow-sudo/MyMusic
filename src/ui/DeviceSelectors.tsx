import type { DeviceKind } from '../audio/devices'

export const OUTPUT_HINT =
  "Tık kayda girmesin: Voicemeeter'da tarayıcı sesini yalnızca A1'e (kulaklık) gönder, B hattına gönderme."

interface Props {
  mics: MediaDeviceInfo[]
  cams: MediaDeviceInfo[]
  outs: MediaDeviceInfo[]
  mic: string
  cam: string
  out: string
  showCam: boolean
  disabled?: boolean
  onChange(kind: DeviceKind, id: string): void
}

function Options({ list, fallback }: { list: MediaDeviceInfo[]; fallback: string }) {
  return (
    <>
      <option value="">Varsayılan</option>
      {list.map((d, i) => (
        <option key={d.deviceId || i} value={d.deviceId}>
          {d.label || `${fallback} ${i + 1}`}
        </option>
      ))}
    </>
  )
}

export default function DeviceSelectors({ mics, cams, outs, mic, cam, out, showCam, disabled, onChange }: Props) {
  return (
    <div className="device-selectors">
      <label>
        Mikrofon
        <select value={mic} disabled={disabled} onChange={(e) => onChange('mic', e.target.value)}>
          <Options list={mics} fallback="Mikrofon" />
        </select>
      </label>
      {showCam && (
        <label>
          Kamera
          <select value={cam} disabled={disabled} onChange={(e) => onChange('cam', e.target.value)}>
            <Options list={cams} fallback="Kamera" />
          </select>
        </label>
      )}
      <label>
        Metronom çıkışı
        <select value={out} disabled={disabled} onChange={(e) => onChange('out', e.target.value)}>
          <Options list={outs} fallback="Çıkış" />
        </select>
      </label>
      <small className="muted">{OUTPUT_HINT}</small>
    </div>
  )
}
