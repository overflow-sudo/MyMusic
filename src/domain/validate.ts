export function validateSongInput(i: {
  title: string
  bpm: number
  countInBeats: number
}): Partial<Record<'title' | 'bpm' | 'countInBeats', string>> {
  const errors: Partial<Record<'title' | 'bpm' | 'countInBeats', string>> = {}
  if (!i.title.trim()) errors.title = 'Şarkı adı boş olamaz.'
  if (!Number.isInteger(i.bpm) || i.bpm < 30 || i.bpm > 300) errors.bpm = 'BPM 30 ile 300 arasında tam sayı olmalı.'
  if (!Number.isInteger(i.countInBeats) || i.countInBeats < 1 || i.countInBeats > 16)
    errors.countInBeats = 'Sayma vuruşu 1 ile 16 arasında tam sayı olmalı.'
  return errors
}
