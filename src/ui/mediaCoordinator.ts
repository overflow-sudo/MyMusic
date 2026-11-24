const players = new Set<HTMLMediaElement>()

export function register(el: HTMLMediaElement): () => void {
  players.add(el)
  return () => {
    players.delete(el)
  }
}

let recording = false

/** While a take runs nothing may play: claimPlayback refuses. */
export function setRecording(on: boolean): void {
  recording = on
}

/** Pauses every registered element except `el`: one medium at a time. Returns false (and pauses `el`) during a take. */
export function claimPlayback(el: HTMLMediaElement): boolean {
  if (recording) {
    el.pause()
    return false
  }
  for (const p of players) if (p !== el) p.pause()
  return true
}

export function pauseAll(): void {
  for (const p of players) p.pause()
}
