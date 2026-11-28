import type { RecordingStatus } from './useSongRecordings'

const svg = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const

const TEXT: Record<RecordingStatus, string> = {
  both: 'Bulutta',
  cloud: 'Yalnız bulutta',
  local: 'Yalnız bu bilgisayarda',
  uploading: 'Yükleniyor…',
  processing: 'Hazırlanıyor…',
  failed: 'Bulutta (dönüştürülemedi)',
}

const CLOUD = 'M7 18a4 4 0 0 1-.6-7.96A5.5 5.5 0 0 1 17 8.5a4.75 4.75 0 0 1 0 9.5z'

function Glyph({ status }: { status: RecordingStatus }) {
  switch (status) {
    case 'both':
      return <svg {...svg}><path d={CLOUD} /><path d="m9.5 13 2 2 3.5-4" /></svg>
    case 'cloud':
      return <svg {...svg}><path d={CLOUD} /></svg>
    case 'uploading':
      return <svg {...svg}><path d="M12 19V7" /><path d="m7 11 5-5 5 5" /><path d="M5 20h14" /></svg>
    case 'processing':
      return <svg {...svg}><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></svg>
    case 'failed':
      return <svg {...svg}><path d={CLOUD} /><path d="M12 10v3M12 15.5v.01" /></svg>
    default: // local: a computer
      return <svg {...svg}><rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M9 20h6M12 16v4" /></svg>
  }
}

export default function RecordingStatusIcon({ status }: { status: RecordingStatus }) {
  return (
    <span className={`rec-status rec-status-${status}`} title={TEXT[status]}>
      <Glyph status={status} />
      <span className="sr-only">{TEXT[status]}</span>
    </span>
  )
}
