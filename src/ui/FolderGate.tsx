interface Props {
  hasSaved: boolean
  note?: string
  onPick: () => void
  onReconnect: () => void
}

export default function FolderGate({ hasSaved, note, onPick, onReconnect }: Props) {
  return (
    <main className="screen narrow hero">
      <h1 className="display">MyMusic</h1>
      <p className="lead">Repertuvarın ve kayıtların seçtiğin bir klasörde dosya olarak saklanır.</p>
      {note && <p role="alert" className="note">{note}</p>}
      <div className="actions">
        {hasSaved ? (
          <>
            <button className="btn btn-primary" onClick={onReconnect}>Klasöre tekrar bağlan</button>
            <button className="btn btn-ghost" onClick={onPick}>Başka klasör seç</button>
          </>
        ) : (
          <button className="btn btn-primary" onClick={onPick}>Klasör seç</button>
        )}
      </div>
    </main>
  )
}
