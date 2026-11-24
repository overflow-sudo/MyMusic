import { useEffect, useState } from 'react'
import { formatTimecode, parseTimecode } from '../domain/time'
import type { Track } from '../domain/types'

interface Props {
  track: Track | undefined
  onImport: (file: File) => Promise<void>
  onRemove: () => Promise<void>
  onChange: (track: Track) => Promise<void>
}

type Handlers = Omit<Props, 'track'>

export default function TrackPanel({ track, onImport, onRemove, onChange }: Props) {
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) void onImport(file)
  }

  return (
    <section className="track-panel">
      <h2>Altyapı parçası</h2>
      {track ? (
        // Keyed so start-point text/error never outlive the track they belong to.
        <TrackControls key={track.fileName} track={track} pick={pick} onRemove={onRemove} onChange={onChange} />
      ) : (
        <label>
          Parça ekle
          <input type="file" accept="audio/*" onChange={pick} />
        </label>
      )}
    </section>
  )
}

function TrackControls({
  track,
  pick,
  onRemove,
  onChange,
}: { track: Track; pick: (e: React.ChangeEvent<HTMLInputElement>) => void } & Pick<Handlers, 'onRemove' | 'onChange'>) {
  const [start, setStart] = useState(formatTimecode(track.startSec))
  const [startError, setStartError] = useState(false)
  const [volume, setVolume] = useState(Math.round(track.volume * 100))
  useEffect(() => setStart(formatTimecode(track.startSec)), [track.startSec])
  useEffect(() => setVolume(Math.round(track.volume * 100)), [track.volume])

  const commitStart = () => {
    const sec = parseTimecode(start)
    if (sec === null) return setStartError(true)
    setStartError(false)
    if (sec !== track.startSec) void onChange({ ...track, startSec: sec })
    else setStart(formatTimecode(sec))
  }
  // Slider drags only update local state; one save happens when the gesture ends.
  const commitVolume = () => {
    if (volume / 100 !== track.volume) void onChange({ ...track, volume: volume / 100 })
  }

  return (
    <>
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
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          onPointerUp={commitVolume}
          onKeyUp={commitVolume}
          onBlur={commitVolume}
        />
        <span>{volume}%</span>
      </div>
    </>
  )
}
