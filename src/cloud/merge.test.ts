import { describe, expect, it } from 'vitest'
import type { Song } from '../domain/types'
import { mergeLibraries, mergeSong } from './merge'

const T1 = '2026-11-28T10:00:00.000Z'
const T2 = '2026-11-28T11:00:00.000Z'
const song = (id: string, updatedAt: string, extra: Partial<Song> = {}): Song => ({
  id, title: `T ${id}`, artist: 'A', status: 'learning', bpm: 90, countInBeats: 4,
  folderName: `f-${id}`, createdAt: T1, updatedAt, ...extra,
})

describe('mergeSong', () => {
  it('only one side → that side', () => {
    const a = song('a', T1)
    expect(mergeSong(a, undefined)).toBe(a)
    expect(mergeSong(undefined, a)).toBe(a)
    expect(mergeSong(undefined, undefined)).toBeUndefined()
  })

  it('newer wins in both directions', () => {
    const older = song('a', T1, { title: 'old' })
    const newer = song('a', T2, { title: 'new' })
    expect(mergeSong(older, newer)).toBe(newer)
    expect(mergeSong(newer, older)).toBe(newer)
  })

  it('compares by Date.parse, not string order', () => {
    const a = song('a', '2026-11-28T10:00:00Z', { title: 'a' })
    const b = song('a', '2026-11-28T10:00:00.500Z', { title: 'b' })
    expect(mergeSong(a, b)).toBe(b)
  })

  it('tombstone beats an older edit; an older tombstone loses to a newer edit', () => {
    const edit = song('a', T1, { bpm: 120 })
    const tomb = song('a', T2, { deletedAt: T2 })
    expect(mergeSong(edit, tomb)).toBe(tomb)
    expect(mergeSong(tomb, edit)).toBe(tomb)
    const oldTomb = song('a', T1, { deletedAt: T1 })
    const newEdit = song('a', T2, { bpm: 130 })
    expect(mergeSong(oldTomb, newEdit)).toBe(newEdit)
    expect(mergeSong(newEdit, oldTomb)).toBe(newEdit)
  })

  it('equal updatedAt keeps local and fills a missing cover / track.hash from remote', () => {
    const local = song('a', T1, { title: 'local', track: { fileName: 'track.mp3', startSec: 0, volume: 1 } })
    const remote = song('a', T1, {
      title: 'remote',
      cover: { source: 'itunes', fileName: 'cover.jpg' },
      track: { fileName: 'track.mp3', startSec: 5, volume: 0.5, hash: 'h1' },
    })
    const m = mergeSong(local, remote)!
    expect(m.title).toBe('local')
    expect(m.cover).toEqual({ source: 'itunes', fileName: 'cover.jpg' })
    expect(m.track).toEqual({ fileName: 'track.mp3', startSec: 0, volume: 1, hash: 'h1' })
  })

  it('equal updatedAt never overwrites a non-empty local cover / hash', () => {
    const local = song('a', T1, {
      cover: { source: 'user', fileName: 'cover.png' },
      track: { fileName: 'track.mp3', startSec: 0, volume: 1, hash: 'mine' },
    })
    const remote = song('a', T1, {
      cover: { source: 'itunes', fileName: 'cover.jpg' },
      track: { fileName: 'track.mp3', startSec: 0, volume: 1, hash: 'theirs' },
    })
    expect(mergeSong(local, remote)).toBe(local)
    // a removed-on-purpose cover counts as set
    const none = song('a', T1, { cover: { source: 'none' } })
    expect(mergeSong(none, remote)!.cover).toEqual({ source: 'none' })
  })

  it('equal updatedAt does not take a hash for a different track file', () => {
    const local = song('a', T1, { track: { fileName: 'track.wav', startSec: 0, volume: 1 } })
    const remote = song('a', T1, { track: { fileName: 'track.mp3', startSec: 0, volume: 1, hash: 'h' } })
    expect(mergeSong(local, remote)).toBe(local)
  })

  it('equal updatedAt fills cover.hash only for the same cover file', () => {
    const local = song('a', T1, { cover: { source: 'itunes', fileName: 'cover.jpg' } })
    const same = song('a', T1, { cover: { source: 'itunes', fileName: 'cover.jpg', hash: 'c' } })
    const other = song('a', T1, { cover: { source: 'user', fileName: 'cover.png', hash: 'c' } })
    expect(mergeSong(local, same)!.cover).toEqual({ source: 'itunes', fileName: 'cover.jpg', hash: 'c' })
    expect(mergeSong(local, other)).toBe(local)
  })
})

describe('mergeLibraries', () => {
  it('local-only is pushed; remote-only is adopted', () => {
    const l = song('l', T1)
    const r = song('r', T1)
    const { merged, toPush } = mergeLibraries([l], [r])
    expect(merged).toEqual([l, r])
    expect(toPush).toEqual(['l'])
  })

  it('pushes when local wins, not when remote wins or both are the same', () => {
    const { merged, toPush } = mergeLibraries(
      [song('a', T2, { title: 'local new' }), song('b', T1), song('c', T1)],
      [song('a', T1), song('b', T2, { title: 'remote new' }), song('c', T1)],
    )
    expect(merged.map((s) => s.title)).toEqual(['local new', 'remote new', 'T c'])
    expect(toPush).toEqual(['a'])
  })

  it('equal updatedAt: pushes when local has a cover / hash the server lacks (auto backfill)', () => {
    const { toPush } = mergeLibraries(
      [song('a', T1, { cover: { source: 'itunes', fileName: 'cover.jpg' } }), song('b', T1, { track: { fileName: 't.mp3', startSec: 0, volume: 1, hash: 'h' } })],
      [song('a', T1), song('b', T1, { track: { fileName: 't.mp3', startSec: 0, volume: 1 } })],
    )
    expect(toPush).toEqual(['a', 'b'])
  })

  it('empty local adopts every server song (tombstones included)', () => {
    const remote = [song('a', T1), song('b', T2, { deletedAt: T2 })]
    const { merged, toPush } = mergeLibraries([], remote)
    expect(merged).toEqual(remote)
    expect(toPush).toEqual([])
  })

  it('a local tombstone newer than the server copy is pushed', () => {
    const { merged, toPush } = mergeLibraries([song('a', T2, { deletedAt: T2 })], [song('a', T1)])
    expect(merged[0].deletedAt).toBe(T2)
    expect(toPush).toEqual(['a'])
  })

  it('equal updatedAt with a server tombstone: never pushed for a fill (server would not fill it)', () => {
    const local = song('a', T1, { deletedAt: T1, cover: { source: 'itunes', fileName: 'cover.jpg' }, track: { fileName: 't.mp3', startSec: 0, volume: 1, hash: 'h' } })
    const remote = song('a', T1, { deletedAt: T1, track: { fileName: 't.mp3', startSec: 0, volume: 1 } })
    expect(mergeLibraries([local], [remote]).toPush).toEqual([])
  })
})
