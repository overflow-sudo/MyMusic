export const CHORD_RE =
  /^[A-G](#|b)?(m|maj|min|dim|aug|sus|add)?\d{0,2}(sus\d|add\d|maj\d|b\d|#\d)*(\/[A-G](#|b)?)?$/

export type ChordLine =
  | { kind: 'chords'; text: string }
  | { kind: 'inline'; parts: { chord?: string; text: string }[] }
  | { kind: 'section'; label: string }
  | { kind: 'lyric'; text: string }
  | { kind: 'blank' }

export function isChord(token: string): boolean {
  return CHORD_RE.test(token)
}

const FILLER = new Set(['|', '||', '/', '-', '(', ')', 'N.C.'])

/** Strip attached parentheses: "(Am" -> "Am", "G)" -> "G". */
export function stripParens(token: string): string {
  return token.replace(/^\(+/, '').replace(/\)+$/, '')
}

export function isFiller(token: string): boolean {
  return FILLER.has(token) || /^x\d+$/.test(token)
}

function isChordLine(line: string): boolean {
  const tokens = line.trim().split(/\s+/)
  let real = 0
  for (const raw of tokens) {
    if (FILLER.has(raw)) continue
    const t = stripParens(raw)
    if (t === '' || isFiller(t)) continue
    if (isChord(t)) real++
    else return false
  }
  return real > 0
}

const INLINE_RE = /\[([^\][\s]+)\]/g

function parseInline(line: string): ChordLine | null {
  const parts: { chord?: string; text: string }[] = []
  let last = 0
  let found = false
  for (const m of line.matchAll(INLINE_RE)) {
    if (!isChord(m[1])) continue
    found = true
    const before = line.slice(last, m.index)
    if (parts.length === 0) {
      if (before) parts.push({ text: before })
    } else {
      parts[parts.length - 1].text += before
    }
    parts.push({ chord: m[1], text: '' })
    last = m.index + m[0].length
  }
  if (!found) return null
  const rest = line.slice(last)
  if (parts.length > 0) parts[parts.length - 1].text += rest
  return { kind: 'inline', parts }
}

export function parseChords(src: string): ChordLine[] {
  return src.split(/\r\n|\r|\n/).map((line): ChordLine => {
    if (line.trim() === '') return { kind: 'blank' }
    const inline = parseInline(line)
    if (inline) return inline
    const sec = /^\s*\[([^\]]+)\]\s*$/.exec(line)
    if (sec) return { kind: 'section', label: sec[1].trim() }
    if (isChordLine(line)) return { kind: 'chords', text: line }
    return { kind: 'lyric', text: line }
  })
}
