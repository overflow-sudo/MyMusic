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
    <main className="screen">
      <h1>Şarkı listesi okunamadı</h1>
      <p role="alert" className="note">{error ?? 'mymusic.json okunamadı.'}</p>
      <p className="muted">Dosyaya dokunulmadı. İstersen mevcut dosyanın yedeğini alıp boş bir liste başlatabilirsin.</p>
      {failed && <p role="alert" className="note">Yedekleme başarısız oldu, tekrar dene.</p>}
      <button onClick={() => void reset()}>Yedekle ve yeni liste başlat</button>
    </main>
  )
}
