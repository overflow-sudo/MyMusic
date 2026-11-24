interface Props {
  error?: string
  onReset: () => void
}

export default function BrokenLibrary({ error, onReset }: Props) {
  return (
    <main className="screen">
      <h1>Şarkı listesi okunamadı</h1>
      <p role="alert" className="note">{error ?? 'mymusic.json okunamadı.'}</p>
      <p className="muted">Dosyaya dokunulmadı. İstersen mevcut dosyanın yedeğini alıp boş bir liste başlatabilirsin.</p>
      <button onClick={onReset}>Yedekle ve yeni liste başlat</button>
    </main>
  )
}
