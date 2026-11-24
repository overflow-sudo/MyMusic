interface Props {
  hasSaved: boolean
  note?: string
  onPick: () => void
  onReconnect: () => void
}

export default function FolderGate({ hasSaved, note, onPick, onReconnect }: Props) {
  return (
    <main className="screen">
      <h1>MyMusic</h1>
      <p>Repertuvarın ve kayıtların seçtiğin bir klasörde dosya olarak saklanır.</p>
      {note && <p role="alert" className="note">{note}</p>}
      {hasSaved ? (
        <>
          <button onClick={onReconnect}>Klasöre tekrar bağlan</button>
          <button className="link" onClick={onPick}>Başka klasör seç</button>
        </>
      ) : (
        <button onClick={onPick}>Klasör seç</button>
      )}
    </main>
  )
}
