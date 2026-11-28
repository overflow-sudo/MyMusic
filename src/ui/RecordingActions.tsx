import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'

interface Props {
  /** Starts the download; rejections are the caller's to report. */
  onDownload(): void | Promise<void>
  /** Deletes the recording; a rejection shows "Silinemedi, tekrar dene." in the row. */
  onDelete(): Promise<void>
  /** More buttons (Paylaş, later) go between İndir and Sil. */
  extra?: ReactNode
  /** Confirm question (cloud connected: also deletes there). */
  confirmText?: string
}

/** Saves `file` through a temporary anchor; the object URL is revoked right after the click. */
export function downloadFile(file: Blob, fileName: string): void {
  const url = URL.createObjectURL(file)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.hidden = true
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const svg = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: false } as const

const DownloadIcon = () => (
  <svg {...svg}><path d="M12 4v11" /><path d="m7 11 5 5 5-5" /><path d="M5 20h14" /></svg>
)
const TrashIcon = () => (
  <svg {...svg}><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /><path d="M10 11v6M14 11v6" /></svg>
)

export default function RecordingActions({ onDownload, onDelete, extra, confirmText = 'Bu kayıt silinsin mi?' }: Props) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const cancelBtn = useRef<HTMLButtonElement>(null)
  const deleteBtn = useRef<HTMLButtonElement>(null)
  const restoreFocus = useRef(false)

  useEffect(() => {
    if (confirming) cancelBtn.current?.focus()
    else if (restoreFocus.current) {
      restoreFocus.current = false
      deleteBtn.current?.focus()
    }
  }, [confirming])

  const stop = (e: { stopPropagation(): void }) => e.stopPropagation()
  const cancel = () => {
    restoreFocus.current = true
    setConfirming(false)
  }
  const confirm = async () => {
    setBusy(true)
    setFailed(false)
    try {
      await onDelete() // on success the row unmounts
    } catch {
      setFailed(true)
      setBusy(false)
      requestAnimationFrame(() => cancelBtn.current?.focus())
    }
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return
    e.stopPropagation()
    cancel()
  }

  if (confirming)
    return (
      <div className="recording-actions recording-confirm" role="group" aria-label="Silme onayı" onClick={stop} onKeyDown={onKey}>
        <span>{confirmText}</span>
        <button type="button" className="danger" disabled={busy} onClick={() => void confirm()}>Sil</button>
        <button type="button" ref={cancelBtn} disabled={busy} onClick={cancel}>Vazgeç</button>
        {failed && <span className="recording-error" role="alert">Silinemedi, tekrar dene.</span>}
      </div>
    )

  return (
    <div className="recording-actions" onClick={stop}>
      <button type="button" className="icon-btn" aria-label="İndir" title="İndir" onClick={() => void onDownload()}>
        <DownloadIcon />
      </button>
      {extra}
      <button type="button" className="icon-btn" ref={deleteBtn} aria-label="Sil" title="Sil" onClick={() => { setFailed(false); setConfirming(true) }}>
        <TrashIcon />
      </button>
    </div>
  )
}
