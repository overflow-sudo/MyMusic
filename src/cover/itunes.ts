export interface CoverHit { artworkUrl: string }

export function itunesUrl(title: string, artist: string): string {
  return `https://itunes.apple.com/search?term=${encodeURIComponent(title + ' ' + artist)}&entity=song&limit=1&country=TR`
}

const TIMEOUT_MS = 8000
let seq = 0

export function jsonp(url: string, timeoutMs: number = TIMEOUT_MS): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const name = `__mymusicJsonp${Date.now().toString(36)}_${seq++}`
    const w = window as unknown as Record<string, unknown>
    const script = document.createElement('script')
    let timer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      clearTimeout(timer)
      script.remove()
      delete w[name]
    }
    w[name] = (payload: unknown) => { cleanup(); resolve(payload) }
    script.onerror = () => { cleanup(); reject(new Error('jsonp error')) }
    timer = setTimeout(() => { cleanup(); reject(new Error('jsonp timeout')) }, timeoutMs)
    script.src = `${url}${url.includes('?') ? '&' : '?'}callback=${name}`
    document.head.appendChild(script)
  })
}

export async function searchCover(
  title: string,
  artist: string,
  deps: { fetch?: typeof fetch; jsonp?: (url: string) => Promise<unknown>; timeoutMs?: number } = {},
): Promise<CoverHit | null> {
  try {
    const url = itunesUrl(title, artist)
    const doFetch = deps.fetch ?? ((u: string) => fetch(u))
    const doJsonp = deps.jsonp ?? ((u: string) => jsonp(u, deps.timeoutMs))
    let data: unknown
    let res: Response | null = null
    try {
      res = await doFetch(url)
    } catch {
      data = await doJsonp(url)
    }
    if (res) {
      if (!res.ok) return null
      data = await res.json()
    }
    const first = (data as { results?: { artworkUrl100?: unknown }[] } | null)?.results?.[0]
    const art = first?.artworkUrl100
    if (typeof art !== 'string' || !art) return null
    return { artworkUrl: art.replace('100x100', '600x600') }
  } catch {
    return null
  }
}
