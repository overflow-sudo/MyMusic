import { useEffect, useRef, type ReactNode } from 'react'

interface Props {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Right-side settings panel. It stays mounted while closed (inert + hidden from view) so its contents keep their
 * state — a pending edit, a track preview, the device-settings portal target — across open/close.
 */
export default function Drawer({ open, onClose, title, children }: Props) {
  const panel = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const returnTo = useRef<HTMLElement | null>(null)
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Closing never leaves sound running behind the panel (e.g. the track preview after Esc).
  useEffect(() => {
    if (open) return
    body.current?.querySelectorAll<HTMLMediaElement>('audio, video').forEach((m) => m.pause())
  }, [open])

  useEffect(() => {
    if (!open) return
    returnTo.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first = [...(body.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].find((el) => !el.closest('[hidden]'))
    ;(first ?? panel.current)?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      const back = returnTo.current
      returnTo.current = null
      if (back?.isConnected) back.focus()
    }
  }, [open])

  return (
    <div className={open ? 'drawer-root open' : 'drawer-root'} inert={!open}>
      <div className="drawer-backdrop" onClick={onClose} aria-hidden="true" />
      <div ref={panel} className="drawer" role="dialog" aria-modal="true" aria-label={title} aria-hidden={!open} tabIndex={-1}>
        <div className="drawer-head">
          <h2 className="drawer-title">{title}</h2>
          <button type="button" className="icon-btn" aria-label="Kapat" onClick={onClose}>
            ✕
          </button>
        </div>
        <div ref={body} className="drawer-body">
          {children}
        </div>
      </div>
    </div>
  )
}
