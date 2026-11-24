/** Count-in shown in the middle of the stage. Stays a dialog with class "countdown": the shortcut rules rely on it. */
export default function CountdownOverlay({ beatsLeft, onCancel }: { beatsLeft: number; onCancel(): void }) {
  return (
    <div className="countdown" role="dialog" aria-label="Sayım">
      <div className="countdown-beat" aria-live="assertive">
        {beatsLeft}
      </div>
      <div className="countdown-foot">
        <span>Esc: iptal</span>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          İptal
        </button>
      </div>
    </div>
  )
}
