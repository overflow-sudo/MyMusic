import { useEffect, useState, type CSSProperties } from 'react'
import type { Song } from '../domain/types'
import type { FsDir } from '../storage/fsDir'
import { readCover } from '../storage/cover'

interface Props {
  root: FsDir
  song: Song
  /** Edge length in px (CSS may override it, e.g. the smaller song-screen cover on phones). */
  size: number
  className?: string
}

/** Square album cover: the saved file, else the remote iTunes image, else the title's first letter. */
export default function CoverArt({ root, song, size, className }: Props) {
  const cover = song.cover
  // Results are tagged with what they belong to, so a changed cover never shows a stale image or error.
  const [loaded, setLoaded] = useState<{ cover: typeof cover; url: string } | null>(null)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  // Re-read whenever the cover changes (a new object on every patch); one object URL per read, revoked after.
  useEffect(() => {
    if (!cover?.fileName || typeof URL.createObjectURL !== 'function') return
    let cancelled = false
    let made: string | null = null
    readCover(root, song).then(
      (file) => {
        if (cancelled || !file) return
        made = URL.createObjectURL(file)
        setLoaded({ cover, url: made })
      },
      () => {},
    )
    return () => {
      cancelled = true
      if (made) URL.revokeObjectURL(made)
    }
  }, [root, cover]) // eslint-disable-line react-hooks/exhaustive-deps -- song identity changes on every patch

  const fileUrl = loaded && loaded.cover === cover ? loaded.url : null
  const wanted = fileUrl ?? cover?.url ?? null
  const src = wanted === failedSrc ? null : wanted
  const letter = Array.from(song.title.trim())[0]?.toLocaleUpperCase('tr-TR') ?? ''
  const style = { '--cover-size': `${size}px` } as CSSProperties
  return (
    <span className={className ? `cover-art ${className}` : 'cover-art'} style={style}>
      {src ? (
        <img src={src} alt="" referrerPolicy="no-referrer" onError={() => setFailedSrc(src)} />
      ) : (
        <span className="cover-letter" aria-hidden="true">
          {letter}
        </span>
      )}
    </span>
  )
}
