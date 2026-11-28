import { useEffect, useRef, useState } from 'react'
import { CloudError, createApi } from '../cloud/api'
import { DEFAULT_BASE_URL, clearSession, getSession, normalizeBaseUrl, onSessionChange, setSession } from '../cloud/session'
import { getCloudStatus, setCloudStatus, useCloudStatus, type CloudState } from '../cloud/status'

interface Props {
  /** Starts a sync pass (wired up in a later task). */
  onSyncNow?: () => void
  /** Injectable for tests. */
  fetchImpl?: typeof fetch
}

const STATE_TEXT: Record<CloudState, string> = {
  off: 'Bağlı değil',
  connecting: 'Bağlanıyor…',
  connected: 'Bağlı',
  syncing: 'Eşitleniyor…',
  offline: 'Çevrimdışı',
  'needs-login': 'Giriş gerekli',
}

function errorText(e: unknown): string {
  if (!(e instanceof CloudError)) return 'Bağlanılamadı, tekrar dene.'
  switch (e.kind) {
    case 'auth': return 'Şifre yanlış.'
    case 'rate': return e.retryAfter ? `Çok fazla deneme, biraz bekle (≈${Math.max(1, Math.ceil(e.retryAfter / 60))} dk).` : 'Çok fazla deneme, biraz bekle.'
    case 'offline': return 'Sunucuya ulaşılamadı.'
    default: return 'Sunucu hatası, tekrar dene.'
  }
}

export default function CloudSettings({ onSyncNow = () => {}, fetchImpl }: Props) {
  const status = useCloudStatus()
  const [session, setSessionState] = useState(getSession)
  const [address, setAddress] = useState(() => getSession()?.baseUrl ?? DEFAULT_BASE_URL)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => onSessionChange(() => setSessionState(getSession())), [])
  // A stored token with no status yet counts as connected until a call says otherwise.
  useEffect(() => {
    if (session && getCloudStatus().state === 'off') setCloudStatus('connected')
  }, [session])

  const connect = async () => {
    const baseUrl = normalizeBaseUrl(address)
    if (!baseUrl) { setError('Geçersiz sunucu adresi (https:// ile başlamalı).'); return }
    if (!password) { setError('Şifreyi gir.'); return }
    setError(null)
    setBusy(true)
    const before = getCloudStatus().state
    setCloudStatus('connecting')
    try {
      const { token } = await createApi({ baseUrl, token: null }, fetchImpl).login(password)
      setSession({ baseUrl, token })
      setCloudStatus('connected')
      if (alive.current) { setPassword(''); setAddress(baseUrl) }
    } catch (e) {
      setCloudStatus(before === 'connecting' ? 'off' : before === 'offline' ? (session ? 'offline' : 'off') : before)
      if (alive.current) setError(errorText(e))
    } finally {
      if (alive.current) setBusy(false)
    }
  }

  const logout = () => {
    clearSession()
    setCloudStatus('off')
    setError(null)
    setPassword('')
  }

  return (
    <div className="modal-field" role="group" aria-label="Bulut">
      <h3 className="drawer-label">Bulut</h3>
      <label>
        Sunucu adresi
        <input type="url" value={address} disabled={!!session && status.state !== 'needs-login'} onChange={(e) => setAddress(e.target.value)} />
      </label>
      <label>
        Şifre
        <input
          type="password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void connect() } }}
        />
      </label>
      <p className="muted" role="status">{STATE_TEXT[status.state]}</p>
      {error && <p className="note" role="alert">{error}</p>}
      <div className="row">
        <button type="button" className="btn" disabled={busy} onClick={() => void connect()}>Bağlan</button>
        {session && (
          <>
            <button type="button" className="btn" onClick={onSyncNow}>Şimdi eşitle</button>
            <button type="button" className="btn btn-ghost" onClick={logout}>Çıkış yap</button>
          </>
        )}
      </div>
    </div>
  )
}
