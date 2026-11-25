import { useMemo } from 'react'
import { isChord, isFiller, parseChords, stripParens } from '../chords/parseChords'

function ChordTokens({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\s+)/).map((tok, i) => {
        const core = stripParens(tok)
        if (core !== '' && !isFiller(core) && isChord(core)) {
          const start = tok.indexOf(core)
          return (
            <span key={i}>
              {tok.slice(0, start)}
              <span className="chord">{core}</span>
              {tok.slice(start + core.length)}
            </span>
          )
        }
        return tok
      })}
    </>
  )
}

export function ChordSheet({ text, size = 'sm' }: { text: string; size?: 'sm' | 'lg' }) {
  const lines = useMemo(() => parseChords(text), [text])
  return (
    <div className={`chord-sheet ${size}`}>
      {lines.map((l, i) => {
        switch (l.kind) {
          case 'blank':
            return <div key={i} className="chord-blank">{' '}</div>
          case 'section':
            return <div key={i} className="chord-section">{l.label}</div>
          case 'lyric':
            return <div key={i} className="chord-lyric">{l.text}</div>
          case 'chords':
            return (
              <div key={i} className="chord-line">
                <ChordTokens text={l.text} />
              </div>
            )
          case 'inline':
            return (
              <div key={i} className="chord-inline">
                {l.parts.map((p, j) => (
                  <span key={j} className="chord-part">
                    <span className="chord-above">{p.chord && <span className="chord">{p.chord}</span>}</span>
                    <span className="chord-text">{p.text}</span>
                  </span>
                ))}
              </div>
            )
        }
      })}
    </div>
  )
}

export default ChordSheet
