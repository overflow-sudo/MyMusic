import type { Song } from '../domain/types'

// Pure per-song merge (spec decision 7, global constraints "Song merge"); mirrors server/src/library.ts.

const time = (s: Song): number => {
  const t = Date.parse(s.updatedAt)
  return Number.isFinite(t) ? t : -Infinity
}

/** Equal updatedAt: keep `local`, filling a missing cover / cover.hash / track.hash from `remote`. Returns `local` itself when nothing is filled. */
function fill(local: Song, remote: Song): Song {
  let out = local
  const lc = local.cover
  const rc = remote.cover
  if (!lc && rc) out = { ...out, cover: rc }
  else if (lc && rc && !lc.hash && rc.hash && lc.source === rc.source && lc.fileName === rc.fileName)
    out = { ...out, cover: { ...lc, hash: rc.hash } }
  const lt = local.track
  const rt = remote.track
  if (lt && rt && !lt.hash && rt.hash && lt.fileName === rt.fileName) out = { ...out, track: { ...lt, hash: rt.hash } }
  return out
}

/** True when the server copy (equal updatedAt) lacks a cover / hash that `merged` has, so pushing lets the server fill it. */
function serverCanFill(merged: Song, remote: Song): boolean {
  // The server never fills a stored tombstone (server/src/library.ts), so pushing would repeat every pass.
  if (remote.deletedAt) return false
  const mc = merged.cover
  const rc = remote.cover
  if (mc && !rc) return true
  if (mc?.hash && rc && !rc.hash && mc.source === rc.source && mc.fileName === rc.fileName) return true
  const mt = merged.track
  const rt = remote.track
  return !!mt?.hash && !!rt && !rt.hash && rt.fileName === mt.fileName
}

function decide(local: Song | undefined, remote: Song | undefined): { song: Song | undefined; push: boolean } {
  if (!local) return { song: remote, push: false }
  if (!remote) return { song: local, push: true }
  const l = time(local)
  const r = time(remote)
  if (l > r) return { song: local, push: true }
  if (r > l) return { song: remote, push: false }
  const song = fill(local, remote)
  return { song, push: serverCanFill(song, remote) }
}

/** Merged copy of one song. Returns one of the inputs unchanged (same object) unless an equal-time fill applied. */
export function mergeSong(local?: Song, remote?: Song): Song | undefined {
  return decide(local, remote).song
}

/** Local order first, then server-only songs. `toPush` = ids whose local copy the server should get. */
export function mergeLibraries(localSongs: Song[], remoteSongs: Song[]): { merged: Song[]; toPush: string[] } {
  const remoteById = new Map(remoteSongs.map((s) => [s.id, s]))
  const localIds = new Set(localSongs.map((s) => s.id))
  const merged: Song[] = []
  const toPush: string[] = []
  for (const local of localSongs) {
    const { song, push } = decide(local, remoteById.get(local.id))
    merged.push(song!)
    if (push) toPush.push(local.id)
  }
  for (const remote of remoteSongs) {
    if (localIds.has(remote.id)) continue
    localIds.add(remote.id) // a duplicated server id is taken once
    merged.push(remote)
  }
  return { merged, toPush }
}
