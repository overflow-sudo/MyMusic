import { useState } from 'react'
import type { Song } from '../domain/types'
import ChordSheet from './ChordSheet'

interface Props {
  song: Song
  /** Saves the chords (undefined = none); failures are reported by the caller. */
  onSave: (chords: string | undefined) => void
}

export const chordsSearchUrl = (song: Song) => `https://www.google.com/search?q=${encodeURIComponent(`${song.title} ${song.artist} chords`)}`

/** Drawer "Akorlar" section body: pasted chord sheet (saved on blur), a search link and a small preview. */
export default function ChordsEditor({ song, onSave }: Props) {
  const [text, setText] = useState(song.chords ?? '')
  const commit = () => {
    const next = text.trim() === '' ? undefined : text
    if (next !== song.chords) onSave(next)
  }
  return (
    <>
      <textarea
        id="chords-input"
        className="chords-input"
        aria-label="Akorlar"
        rows={10}
        spellCheck={false}
        placeholder="Akorları buraya yapıştır…"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
      />
      <a className="chords-search" href={chordsSearchUrl(song)} target="_blank" rel="noopener">
        Akorları ara ↗
      </a>
      {text.trim() !== '' && (
        <div className="chords-preview">
          <ChordSheet text={text} size="sm" />
        </div>
      )}
    </>
  )
}
