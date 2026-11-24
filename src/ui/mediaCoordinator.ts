const players = new Set<HTMLMediaElement>()

export function register(el: HTMLMediaElement): () => void {
  players.add(el)
  return () => {
    players.delete(el)
  }
}

/** Pauses every registered element except `el`: one medium at a time. */
export function claimPlayback(el: HTMLMediaElement): void {
  for (const p of players) if (p !== el) p.pause()
}

export function pauseAll(): void {
  for (const p of players) p.pause()
}
