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
  | { kind: 'open'; handle: FileSystemDirectoryHandle }

function Shell({ handle }: { handle: FileSystemDirectoryHandle }) {
  const root = useMemo(() => fromHandle(handle), [handle])
  const lib = useLibrary(root)
  if (lib.status === 'loading') return <main className="screen"><p>Yükleniyor…</p></main>
  if (lib.status === 'broken') return <BrokenLibrary error={lib.error} onReset={() => void lib.resetBroken()} />
  return (
    <main className="screen">
      <p>Şarkı listesi burada olacak</p>
    </main>
  )
}

export default function App() {
  const supported = typeof window.showDirectoryPicker === 'function'
  const [phase, setPhase] = useState<Phase>({ kind: 'checking' })
  const [recovered, setRecovered] = useState(0)
  useEffect(() => {
    if (recovered === 0) return
    const t = setTimeout(() => setRecovered(0), 6000)
    return () => clearTimeout(t)
  }, [recovered])

  const open = useCallback(async (handle: FileSystemDirectoryHandle) => {
    try {
      // Throws NotFoundError when the folder was deleted or moved (fromHandle would hide that as "empty").
      await handle.getDirectoryHandle('recordings', { create: true })
      setRecovered((await recoverPending(fromHandle(handle))).length)
      setPhase({ kind: 'open', handle })
    } catch (e) {
      // Only a missing folder drops the saved handle; other failures keep reconnect available.
      if (isNotFound(e)) setPhase({ kind: 'gate', saved: null, note: NOT_FOUND_NOTE })
      else setPhase({ kind: 'gate', saved: handle, note: 'Klasör açılamadı, lütfen tekrar dene.' })
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

  let body
  if (!supported) body = <Unsupported />
  else if (phase.kind === 'checking') body = <main className="screen"><p>Yükleniyor…</p></main>
  else if (phase.kind === 'open') body = <Shell handle={phase.handle} />
  else {
    const saved = phase.saved
    const fail = (note: string) => setPhase({ kind: 'gate', saved, note })
    body = (
      <FolderGate
        hasSaved={saved !== null}
        note={phase.note}
        onPick={async () => {
          try {
            const h = await pickFolder()
            if (!h) return
            await saveHandle(h)
            await open(h)
          } catch {
            fail('Klasör seçilemedi, lütfen tekrar dene.')
          }
        }}
        onReconnect={async () => {
          try {
            if (saved && (await ensurePermission(saved, true))) await open(saved)
            else fail('Klasöre erişim izni verilmedi.')
          } catch {
            fail('Klasöre bağlanılamadı, lütfen tekrar dene.')
          }
        }}
      />
    )
  }
  return (
    <>
      {body}
      {recovered > 0 && <div role="status" className="toast">{recovered} yarım kayıt kurtarıldı</div>}
    </>
  )
}
