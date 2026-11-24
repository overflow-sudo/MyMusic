import { useEffect, useState } from 'react'
import { formatTimecode, parseTimecode } from '../domain/time'
import type { Track } from '../domain/types'

interface Props {
  track: Track | undefined
  onImport: (file: File) => Promise<void>
  onRemove: () => Promise<void>
  onChange: (track: Track) => Promise<void>
}

export default function TrackPanel({ track, onImport, onRemove, onChange }: Props) {
  const [start, setStart] = useState(formatTimecode(track?.startSec ?? 0))
  const [startError, setStartError] = useState(false)
  useEffect(() => setStart(formatTimecode(track?.startSec ?? 0)), [track?.startSec])

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void onImport(file)
  }

  if (!track) {
    return (
      <section className="track-panel">
        <h2>Altyapı parçası</h2>
        <label>
          Parça ekle
          <input type="file" accept="audio/*" onChange={pick} />
        </label>
      </section>
    )
  }

  const commitStart = () => {
    const sec = parseTimecode(start)
    if (sec === null) return setStartError(true)
    setStartError(false)
    if (sec !== track.startSec) void onChange({ ...track, startSec: sec })
    else setStart(formatTimecode(sec))
  }

  return (
    <section className="track-panel">
      <h2>Altyapı parçası</h2>
      <p>{track.fileName}</p>
      <div className="row">
        <label className="button">
          Değiştir
          <input type="file" accept="audio/*" onChange={pick} hidden />
        </label>
        <button onClick={() => void onRemove()}>Kaldır</button>
      </div>
      <label>
        Başlangıç noktası
        <input value={start} onChange={(e) => setStart(e.target.value)} onBlur={commitStart} />
      </label>
      {startError && <p className="note" role="alert">Geçersiz süre</p>}
      <div className="row">
        <input
          aria-label="Ses seviyesi"
          type="range"
          min={0}
          max={100}
          value={Math.round(track.volume * 100)}
          onChange={(e) => void onChange({ ...track, volume: Number(e.target.value) / 100 })}
        />
        <span>{Math.round(track.volume * 100)}%</span>
      </div>
    </section>
  )
}
