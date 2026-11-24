import { useCallback, useEffect, useMemo, useState } from 'react'
import { useLibrary } from './state/useLibrary'
import { ensurePermission, getSavedHandle, pickFolder, saveHandle } from './storage/folderHandle'
import { fromHandle } from './storage/fsDir'
import { recoverPending } from './storage/chunkWriter'
import BrokenLibrary from './ui/BrokenLibrary'
import FolderGate from './ui/FolderGate'
import Unsupported from './ui/Unsupported'
import './ui/app.css'

const NOT_FOUND_NOTE = 'Klasör bulunamadı, lütfen tekrar seç.'
const isNotFound = (e: unknown) => e instanceof DOMException && e.name === 'NotFoundError'

type Phase =
  | { kind: 'checking' }
  | { kind: 'gate'; saved: FileSystemDirectoryHandle | null; note?: string }
  | { kind: 'open'; handle: FileSystemDirectoryHandle; recovered: number }

function Shell({ handle, recovered }: { handle: FileSystemDirectoryHandle; recovered: number }) {
  const root = useMemo(() => fromHandle(handle), [handle])
  const lib = useLibrary(root)
  const [toast, setToast] = useState(recovered > 0)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(false), 6000)
    return () => clearTimeout(t)
  }, [toast])

  if (lib.status === 'loading') return <main className="screen"><p>Yükleniyor…</p></main>
  if (lib.status === 'broken') return <BrokenLibrary error={lib.error} onReset={() => void lib.resetBroken()} />
  return (
    <main className="screen">
      <p>Şarkı listesi burada olacak</p>
      {toast && <div role="status" className="toast">{recovered} yarım kayıt kurtarıldı</div>}
    </main>
  )
}

export default function App() {
  const supported = typeof window.showDirectoryPicker === 'function'
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' })

  const open = useCallback(async (handle: FileSystemDirectoryHandle) => {
    try {
      // Throws NotFoundError when the folder was deleted or moved (fromHandle would hide that as "empty").
      await handle.getDirectoryHandle('recordings', { create: true })
      const recovered = (await recoverPending(fromHandle(handle))).length
      setPhase({ kind: 'open', handle, recovered })
    } catch (e) {
      setPhase({ kind: 'gate', saved: null, note: isNotFound(e) ? NOT_FOUND_NOTE : 'Klasör açılamadı, lütfen tekrar seç.' })
    }
  }, [])

  useEffect(() => {
    if (!supported) return
    let cancelled = false
    void (async () => {
      const saved = await getSavedHandle()
      if (cancelled) return
      if (!saved) return setPhase({ kind: 'gate', saved: null })
      if (await ensurePermission(saved, false).catch(() => false)) {
        if (!cancelled) await open(saved)
      } else if (!cancelled) setPhase({ kind: 'gate', saved })
    })()
    return () => {
      cancelled = true
    }
  }, [supported, open])

  if (!supported) return <Unsupported />
  if (phase.kind === 'checking') return <main className="screen"><p>Yükleniyor…</p></main>
  if (phase.kind === 'open') return <Shell handle={phase.handle} recovered={phase.recovered} />

  const saved = phase.saved
  return (
    <FolderGate
      hasSaved={saved !== null}
      note={phase.note}
      onPick={async () => {
        const h = await pickFolder()
        if (!h) return
        await saveHandle(h)
        await open(h)
      }}
      onReconnect={async () => {
        if (saved && (await ensurePermission(saved, true))) await open(saved)
      }}
    />
  )
}
