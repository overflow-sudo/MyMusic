import type { LoginResponse, RecordingInfo, RecordingListItem, SongRecord } from '../../shared/api'
import { getCloudStatus, setCloudStatus } from './status'

export type CloudErrorKind = 'offline' | 'auth' | 'rate' | 'conflict' | 'gone' | 'server' | 'client'

export class CloudError extends Error {
  kind: CloudErrorKind
  status?: number
  retryAfter?: number
  constructor(kind: CloudErrorKind, message: string, extra: { status?: number; retryAfter?: number } = {}) {
    super(message)
    this.name = 'CloudError'
    this.kind = kind
    this.status = extra.status
    this.retryAfter = extra.retryAfter
  }
}

export interface ApiSession { baseUrl: string; token: string | null }
export const JSON_TIMEOUT_MS = 20_000
export const PART_TIMEOUT_MS = 5 * 60_000

interface ReqOpts { body?: BodyInit; json?: unknown; timeoutMs?: number; signal?: AbortSignal; auth?: boolean; loginCall?: boolean }

export function createApi(session: ApiSession, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  async function send(method: string, path: string, o: ReqOpts = {}): Promise<Response> {
    const headers: Record<string, string> = {}
    if (o.auth !== false && session.token) headers.Authorization = `Bearer ${session.token}`
    let body = o.body
    if (o.json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(o.json) }
    const ac = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; ac.abort() }, o.timeoutMs ?? JSON_TIMEOUT_MS)
    const onAbort = () => ac.abort()
    o.signal?.addEventListener('abort', onAbort)
    if (o.signal?.aborted) ac.abort()
    try {
      let res: Response
      try {
        res = await fetchImpl(session.baseUrl + path, { method, headers, body, signal: ac.signal })
      } catch {
        if (o.signal?.aborted) throw new CloudError('client', 'Aborted')
        setCloudStatus('offline', timedOut ? 'Zaman aşımı' : null)
        throw new CloudError('offline', timedOut ? 'Request timed out' : 'Network error')
      }
      if (res.ok) {
        if (getCloudStatus().state === 'offline') setCloudStatus('connected')
        return res
      }
      throw await toError(res, o.loginCall === true)
    } finally {
      clearTimeout(timer)
      o.signal?.removeEventListener('abort', onAbort)
    }
  }

  async function toError(res: Response, loginCall: boolean): Promise<CloudError> {
    let message = `HTTP ${res.status}`
    try { const j = (await res.json()) as { error?: unknown }; if (typeof j.error === 'string') message = j.error } catch { /* no body */ }
    const s = res.status
    if (s === 401) {
      if (!loginCall) setCloudStatus('needs-login')
      return new CloudError('auth', message, { status: s })
    }
    if (s === 429) {
      const ra = Number(res.headers.get('Retry-After'))
      return new CloudError('rate', message, { status: s, retryAfter: Number.isFinite(ra) && ra > 0 ? ra : undefined })
    }
    if (s === 409) return new CloudError('conflict', message, { status: s })
    if (s === 404 || s === 410) return new CloudError('gone', message, { status: s })
    if (s >= 500) return new CloudError('server', message, { status: s })
    return new CloudError('client', message, { status: s })
  }

  async function getJson<T>(method: string, path: string, o?: ReqOpts): Promise<T> {
    const res = await send(method, path, o)
    if (res.status === 204) return undefined as T
    try { return (await res.json()) as T } catch { throw new CloudError('server', 'Bad response', { status: res.status }) }
  }

  const enc = encodeURIComponent
  return {
    login: (password: string) => getJson<LoginResponse>('POST', '/api/login', { json: { password }, auth: false, loginCall: true }),
    health: () => getJson<{ ok: boolean }>('GET', '/health', { auth: false }),
    getLibrary: () => getJson<{ songs: SongRecord[] }>('GET', '/api/library'),
    putSong: (song: SongRecord) => getJson<SongRecord>('PUT', `/api/songs/${enc(song.id)}`, { json: song }),
    getRecordings: () => getJson<RecordingListItem[]>('GET', '/api/recordings'),
    getRecordingUrl: (id: string, o: { download?: boolean } = {}) =>
      getJson<{ url: string }>('GET', `/api/recordings/${enc(id)}/url${o.download ? '?download=1' : ''}`),
    deleteRecording: (id: string) => getJson<unknown>('DELETE', `/api/recordings/${enc(id)}`),
    shareRecording: (id: string) => getJson<{ url: string }>('POST', `/api/recordings/${enc(id)}/share`),
    unshareRecording: (id: string) => getJson<void>('DELETE', `/api/recordings/${enc(id)}/share`),
    /** Whole-file download; `hash` is the server's X-Content-SHA256 (null if absent). */
    async getFile(songId: string, kind: 'track' | 'cover', o: { signal?: AbortSignal } = {}): Promise<{ blob: Blob; hash: string | null }> {
      const res = await send('GET', `/api/songs/${enc(songId)}/${kind}`, { timeoutMs: PART_TIMEOUT_MS, signal: o.signal })
      return { blob: await res.blob(), hash: res.headers.get('X-Content-SHA256') }
    },
    deleteFile: (songId: string, kind: 'track' | 'cover') => getJson<unknown>('DELETE', `/api/songs/${enc(songId)}/${kind}`),
    // Chunked upload primitives (see chunkedUpload.ts)
    createUpload: (o: { signal?: AbortSignal } = {}) => getJson<{ uploadId: string }>('POST', '/api/uploads', o),
    putPart: (uploadId: string, n: number, body: Blob, o: { signal?: AbortSignal } = {}) =>
      getJson<{ size: number }>('PUT', `/api/uploads/${enc(uploadId)}/${n}`, { body, timeoutMs: PART_TIMEOUT_MS, signal: o.signal }),
    completeUpload: (uploadId: string, body: Record<string, unknown>, o: { signal?: AbortSignal } = {}) =>
      getJson<Record<string, unknown>>('POST', `/api/uploads/${enc(uploadId)}/complete`, { json: body, signal: o.signal }),
    abortUpload: (uploadId: string) => getJson<unknown>('DELETE', `/api/uploads/${enc(uploadId)}`),
  }
}

export type CloudApi = ReturnType<typeof createApi>
export type { RecordingInfo }
