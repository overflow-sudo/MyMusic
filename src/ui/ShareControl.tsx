import { useEffect, useState } from 'react'
import type { RecordingsApi } from './useSongRecordings'

const svg = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const

const ShareIcon = () => (
  <svg {...svg}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></svg>
)
const UnshareIcon = () => (
  <svg {...svg}><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /><path d="M4 4l16 16" /></svg>
)

interface Props {
  api: RecordingsApi
  /** Null: not on the server yet (Paylaş is disabled). */
  id: string | null
  shared: boolean
  /** Message under the row ("Bağlantı kopyalandı", errors) and the link to select when copying failed. */
  onNotice(n: { text: string; url?: string; error?: boolean } | null): void
}

async function copy(url: Promise<string>): Promise<string> {
  // Safari only allows the clipboard inside the click: hand it the promise.
  const Item = (globalThis as { ClipboardItem?: new (d: Record<string, Promise<Blob>>) => unknown }).ClipboardItem
  if (Item && navigator.clipboard && 'write' in navigator.clipboard) {
    let resolved = ''
    const blob = url.then((u) => { resolved = u; return new Blob([u], { type: 'text/plain' }) })
    await (navigator.clipboard as unknown as { write(i: unknown[]): Promise<void> }).write([new Item({ 'text/plain': blob })])
    return resolved
  }
  const u = await url
  await navigator.clipboard.writeText(u)
  return u
}

export default function ShareControl({ api, id, shared: initial, onNotice }: Props) {
  const [shared, setShared] = useState(initial)
  const [busy, setBusy] = useState(false)
  useEffect(() => setShared(initial), [initial])

  const share = async () => {
    if (!id) return
    setBusy(true)
    onNotice(null)
    const fetched = api.shareRecording(id).then((r) => r.url)
    try {
      await copy(fetched)
      setShared(true)
      onNotice({ text: 'Bağlantı kopyalandı' })
    } catch {
      // Clipboard refused (or the request failed): show the link when we have it.
      try {
        const url = await fetched
        setShared(true)
        onNotice({ text: 'Bağlantıyı elle kopyala', url })
      } catch {
        onNotice({ text: 'Paylaşılamadı, tekrar dene.', error: true })
      }
    } finally {
      setBusy(false)
    }
  }
  const unshare = async () => {
    if (!id) return
    setBusy(true)
    onNotice(null)
    try {
      await api.unshareRecording(id)
      setShared(false)
      onNotice({ text: 'Paylaşım kaldırıldı' })
    } catch {
      onNotice({ text: 'Paylaşım kaldırılamadı, tekrar dene.', error: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button" className="icon-btn" aria-label="Paylaş" disabled={!id || busy}
        title={id ? 'Paylaş (bağlantıyı kopyala)' : 'Önce buluta yüklenmeli'}
        onClick={() => void share()}
      >
        <ShareIcon />
      </button>
      {id && shared && (
        <button type="button" className="icon-btn" aria-label="Paylaşımı kaldır" title="Paylaşımı kaldır" disabled={busy} onClick={() => void unshare()}>
          <UnshareIcon />
        </button>
      )}
    </>
  )
}
