import { useRef, useState } from 'react'
import type { Song } from '../domain/types'
import type { FsDir } from '../storage/fsDir'
import type { FindResult } from '../cover/useCovers'
import CoverArt from './CoverArt'

interface Props {
  root: FsDir
  song: Song
  onFind: () => Promise<FindResult | null>
  onPick: (file: File) => Promise<'saved' | 'unsupported' | null | void>
  onRemove: () => Promise<void>
}

/** Drawer "Kapak" section: preview plus re-find / own image / remove. Errors are reported by the caller. */
export default function CoverPanel({ root, song, onFind, onPick, onRemove }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [unsupported, setUnsupported] = useState(false)

  const find = async () => {
    if (busy) return
    setBusy(true)
    setNotFound(false)
    setUnsupported(false)
    try {
      setNotFound((await onFind()) === 'none')
    } finally {
      setBusy(false)
    }
  }
  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setNotFound(false)
    setUnsupported(false)
    void onPick(file).then((r) => setUnsupported(r === 'unsupported'))
  }

  return (
    <div className="cover-panel">
      <CoverArt root={root} song={song} size={96} />
      <div className="cover-panel-actions">
        <div className="row">
          <button type="button" className="btn btn-ghost" aria-busy={busy} onClick={() => void find()}>
            {busy ? 'Aranıyor…' : 'Kapağı yeniden bul'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => input.current?.click()}>
            Kendi resmini seç
          </button>
          <input ref={input} type="file" accept="image/*" aria-label="Kendi resmini seç" onChange={pick} hidden />
          {song.cover && song.cover.source !== 'none' && (
            <button type="button" className="btn btn-ghost" onClick={() => void onRemove()}>
              Kaldır
            </button>
          )}
        </div>
        {/* Always present (empty until needed) so screen readers announce the text when it appears. */}
        <p className="dim cover-status" role="status">
          {unsupported ? 'Bu resim biçimi desteklenmiyor.' : notFound ? 'Kapak bulunamadı.' : ''}
        </p>
      </div>
    </div>
  )
}
