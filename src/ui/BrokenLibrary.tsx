import { useState } from 'react'

interface Props {
  error?: string
  onReset: () => Promise<void>
}

export default function BrokenLibrary({ error, onReset }: Props) {
  const [failed, setFailed] = useState(false)
  const reset = async () => {
    setFailed(false)
    try {
      await onReset()
    } catch {
      setFailed(true)
    }
  }
  return (
    <main className="screen narrow hero">
      <h1 className="display">Şarkı listesi okunamadı</h1>
      <p role="alert" className="note">{error ?? 'mymusic.json okunamadı.'}</p>
      <p className="dim">Dosyaya dokunulmadı. İstersen mevcut dosyanın yedeğini alıp boş bir liste başlatabilirsin.</p>
      {failed && <p role="alert" className="note">Yedekleme başarısız oldu, tekrar dene.</p>}
      <div className="actions">
        <button className="btn btn-primary" onClick={() => void reset()}>Yedekle ve yeni liste başlat</button>
      </div>
    </main>
  )
}
