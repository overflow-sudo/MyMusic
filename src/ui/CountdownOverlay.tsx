export default function CountdownOverlay({ beatsLeft, onCancel }: { beatsLeft: number; onCancel(): void }) {
  return (
    <div className="countdown" role="dialog" aria-label="Sayım">
      <div className="countdown-beat">{beatsLeft}</div>
      <p>Esc: iptal</p>
      <button onClick={onCancel}>İptal</button>
    </div>
  )
}
