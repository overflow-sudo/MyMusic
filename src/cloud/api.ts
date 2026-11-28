import type { LoginResponse, RecordingInfo, RecordingListItem, SongRecord } from '../../shared/api'
import { sessionGeneration } from './session'
import { getCloudStatus, setCloudStatus } from './status'

export type CloudErrorKind = 'offline' | 'auth' | 'rate' | 'conflict' | 'gone' | 'server' | 'client'

export class CloudError extends Error {
  kind: CloudErrorKind
  status?: number
  retryAfter?: number
  /** Set to 'complete' when an upload's complete call failed/timed out: the server may have created the item anyway. */
  phase?: 'complete'
  constructor(kind: CloudErrorKind, message: string, extra: { status?: number; retryAfter?: number; phase?: 'complete' } = {}) {
    super(message)
    this.name = 'CloudError'
    this.kind = kind
    this.status = extra.status
    this.retryAfter = extra.retryAfter
    this.phase = extra.phase
  }
}

export interface ApiSession { baseUrl: string; token: string | null }
export const JSON_TIMEOUT_MS = 20_000
export const PART_TIMEOUT_MS = 5 * 60_000
export const COMPLETE_TIMEOUT_MS = 10 * 60_000
export const FILE_TIMEOUT_MS = 10 * 60_000

interface ReqOpts { body?: BodyInit; json?: unknown; timeoutMs?: number; signal?: AbortSignal; auth?: boolean; loginCall?: boolean }

function parseRetryAfter(v: string | null): number | undefined {
  if (!v) return undefined
  const n = Number(v)
  if (Number.isFinite(n)) return n > 0 ? n : undefined
  const t = Date.parse(v)
  if (!Number.isFinite(t)) return undefined
  const sec = Math.ceil((t - Date.now()) / 1000)
  return sec > 0 ? sec : undefined
}

export function createApi(session: ApiSession, fetchImpl: typeof fetch = (...a) => fetch(...a)) {
  const gen = sessionGeneration()
  /** Status updates only count while the session is the one this api was created for. */
  const status = (state: Parameters<typeof setCloudStatus>[0], err: string | null = null) => {
    if (sessionGeneration() === gen) setCloudStatus(state, err)
  }

  /** Runs the request and `read` of its body under one timeout/abort scope. */
  async function request<T>(method: string, path: string, o: ReqOpts, read: (res: Response) => Promise<T>): Promise<T> {
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
    const offline = () => {
      if (o.signal?.aborted) return new CloudError('client', 'Aborted')
      status('offline', timedOut ? 'Zaman aşımı' : null)
      return new CloudError('offline', timedOut ? 'Request timed out' : 'Network error')
    }
    try {
      let res: Response
      try {
        res = await fetchImpl(session.baseUrl + path, { method, headers, body, signal: ac.signal })
      } catch { throw offline() }
      if (!res.ok) throw await toError(res, o.loginCall === true)
      let out: T
      try { out = await read(res) } catch (e) {
        if (e instanceof CloudError) throw e
        throw offline()
      }
      if (getCloudStatus().state === 'offline') status('connected')
      return out
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
      if (!loginCall) status('needs-login')
      return new CloudError('auth', message, { status: s })
    }
    if (s === 429) {
      return new CloudError('rate', message, { status: s, retryAfter: parseRetryAfter(res.headers.get('Retry-After')) })
    }
    if (s === 409) return new CloudError('conflict', message, { status: s })
    if (s === 404 || s === 410) return new CloudError('gone', message, { status: s })
    if (s >= 500) return new CloudError('server', message, { status: s })
    return new CloudError('client', message, { status: s })
  }

  function getJson<T>(method: string, path: string, o: ReqOpts = {}): Promise<T> {
    return request(method, path, o, async (res) => {
      if (res.status === 204) return undefined as T
      const text = await res.text() // network failures here surface as offline
      try { return JSON.parse(text) as T } catch { throw new CloudError('server', 'Bad response', { status: res.status }) }
    })
  }

  const enc = encodeURIComponent
  return {
    login: async (password: string) => {
      const r = await getJson<LoginResponse>('POST', '/api/login', { json: { password }, auth: false, loginCall: true })
      if (!r || typeof r.token !== 'string' || !r.token) throw new CloudError('server', 'Bad response')
      return r
    },
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
      return request('GET', `/api/songs/${enc(songId)}/${kind}`, { timeoutMs: FILE_TIMEOUT_MS, signal: o.signal }, async (res) =>
        ({ blob: await res.blob(), hash: res.headers.get('X-Content-SHA256') }))
    },
    deleteFile: (songId: string, kind: 'track' | 'cover') => getJson<unknown>('DELETE', `/api/songs/${enc(songId)}/${kind}`),
    // Chunked upload primitives (see chunkedUpload.ts)
    createUpload: (o: { signal?: AbortSignal } = {}) => getJson<{ uploadId: string }>('POST', '/api/uploads', o),
    putPart: (uploadId: string, n: number, body: Blob, o: { signal?: AbortSignal } = {}) =>
      getJson<{ size: number }>('PUT', `/api/uploads/${enc(uploadId)}/${n}`, { body, timeoutMs: PART_TIMEOUT_MS, signal: o.signal }),
    /** Long timeout: the server concatenates and hashes. An offline error here carries phase 'complete' (the item may exist; verify before re-uploading). */
    completeUpload: (uploadId: string, body: Record<string, unknown>, o: { signal?: AbortSignal } = {}) =>
      getJson<Record<string, unknown>>('POST', `/api/uploads/${enc(uploadId)}/complete`, { json: body, timeoutMs: COMPLETE_TIMEOUT_MS, signal: o.signal })
        .catch((e) => { if (e instanceof CloudError && e.kind === 'offline') e.phase = 'complete'; throw e }),
    abortUpload: (uploadId: string, o: { signal?: AbortSignal } = {}) => getJson<unknown>('DELETE', `/api/uploads/${enc(uploadId)}`, { signal: o.signal }),
  }
}

export type CloudApi = ReturnType<typeof createApi>
export type { RecordingInfo }
