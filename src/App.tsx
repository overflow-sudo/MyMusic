import { useCallback, useEffect, useMemo, useState } from 'react'
import { deleteRecordingInCloud } from './cloud/deleteRecording'
import { sha256Hex } from './cloud/hash'
import { useHasSession } from './cloud/session'
import { useCloudSync } from './cloud/useCloudSync'
import { useCovers } from './cover/useCovers'
import { listRecordings } from './storage/repo'
import { useLibrary } from './state/useLibrary'
import { ensurePermission, getSavedHandle, pickFolder, saveHandle } from './storage/folderHandle'
import { fromHandle } from './storage/fsDir'
import { recoverPending } from './storage/chunkWriter'
import BrokenLibrary from './ui/BrokenLibrary'
import FolderGate from './ui/FolderGate'
import LightLayer from './ui/LightLayer'
import Recorder from './ui/Recorder'
import type { RecordingCloud } from './ui/RecordingList'
import SettingsDialog from './ui/SettingsDialog'
import SongDetail from './ui/SongDetail'
import SongList from './ui/SongList'
import Unsupported from './ui/Unsupported'
import { useSongLight } from './ui/useSongLight'
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
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null)
  const [recordingCounts, setRecordingCounts] = useState<Record<string, number>>({})
  const [countsVersion, setCountsVersion] = useState(0)
  const [deletedTick, setDeletedTick] = useState(0) // recount without remounting the open list (keeps focus)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [recorderBusy, setRecorderBusy] = useState(false)
  const songs = lib.library.songs // never includes tombstones
  const selected = selectedSongId ? songs.find((s) => s.id === selectedSongId) : undefined
  useSongLight(selected ? selected.bpm : null, selected)
  // Backfill runs while the list is on screen; covers for new songs are searched right after adding.
  const covers = useCovers(root, songs, lib.patchSong, { backfill: lib.status === 'ready' && !selected, hash: sha256Hex })
  const { patchSong, getPendingDeletes, addPendingDelete, clearPendingDeletes } = lib
  const files = useMemo(
    () => ({ root, patchSong, getPendingDeletes, clearPendingDeletes, onRecordingsDeleted: () => setCountsVersion((v) => v + 1) }),
    [root, patchSong, getPendingDeletes, clearPendingDeletes],
  )
  const cloud = useCloudSync({
    ready: lib.status === 'ready',
    busy: recorderBusy,
    revision: lib.revision,
    getLocalSongs: lib.getAllSongs,
    applyMerged: lib.applyMerged,
    files,
  })
  const hasSession = useHasSession()
  const sync = useMemo(() => {
    const recordings: RecordingCloud | undefined = hasSession
      ? { afterLocalDelete: async (song, fileName) => void (await deleteRecordingInCloud(song.id, fileName, { addPendingDelete, clearPendingDeletes })) }
      : undefined
    return { hash: sha256Hex, recordings }
  }, [hasSession, addPendingDelete, clearPendingDeletes])
  useEffect(() => {
    if (lib.status !== 'ready') return
    let cancelled = false
    void (async () => {
      const next: Record<string, number> = {}
      for (const song of songs) {
        try {
          next[song.id] = (await listRecordings(root, song)).length
        } catch {
          next[song.id] = 0
        }
      }
      if (!cancelled) setRecordingCounts(next)
    })()
    return () => {
      cancelled = true
    }
  }, [root, songs, lib.status, countsVersion, deletedTick])
  // The open song was deleted by a sync from the other computer: back to the list (it must not reopen if it returns).
  useEffect(() => {
    if (lib.status !== 'ready' || !selectedSongId || selected) return
    setSelectedSongId(null)
    setRecorderBusy(false)
    setCountsVersion((v) => v + 1)
  }, [lib.status, selectedSongId, selected])
  if (lib.status === 'loading') return <main className="screen narrow"><p className="dim">Yükleniyor…</p></main>
  if (lib.status === 'broken') return <BrokenLibrary error={lib.error} onReset={lib.resetBroken} />
  // SongList stays mounted (hidden) so its tab and search survive opening a song.
  const latencyMs = lib.library.settings.latencyCompensationMs
  return (
    <>
      {settingsOpen && (
        <SettingsDialog
          value={latencyMs}
          onSave={(v) => lib.setSettings({ latencyCompensationMs: v })}
          onClose={() => setSettingsOpen(false)}
          onSyncNow={cloud.syncNow}
        />
      )}
      <div hidden={!!selected} inert={settingsOpen}>
        <SongList
          library={lib.library}
          onOpen={setSelectedSongId}
          onAdd={async (input) => {
            const song = await lib.addSong(input)
            // `once`: the backfill may already have picked the new song up.
            void covers.findCover(song, { once: true, auto: true }).catch(() => undefined)
          }}
          recordingCounts={recordingCounts}
          root={root}
          onSettings={() => setSettingsOpen(true)}
        />
      </div>
      {selected && (
        <SongDetail
          key={selected.id}
          song={selected}
          root={root}
          patchSong={lib.patchSong}
          deleteSong={lib.deleteSong}
          covers={covers}
          sync={sync}
          recordingsVersion={countsVersion}
          onRecordingsChanged={() => setDeletedTick((v) => v + 1)}
          busy={recorderBusy}
          recorder={(drawerOpen) => (
            <Recorder
              song={selected}
              root={root}
              latencyMs={latencyMs}
              shortcutsEnabled={!settingsOpen && !drawerOpen}
              onBusyChange={setRecorderBusy}
              onSaved={() => setCountsVersion((v) => v + 1)}
            />
          )}
          onBack={() => {
            setSelectedSongId(null)
            setRecorderBusy(false)
            setCountsVersion((v) => v + 1)
          }}
        />
      )}
    </>
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
  else if (phase.kind === 'checking') body = <main className="screen narrow"><p className="dim">Yükleniyor…</p></main>
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
      <LightLayer />
      {body}
      {recovered > 0 && <div role="status" className="toast">{recovered} yarım kayıt kurtarıldı</div>}
    </>
  )
}
