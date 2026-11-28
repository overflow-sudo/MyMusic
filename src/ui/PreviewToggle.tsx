/** Round eye / eye-off button in the stage corner. data-keeps-space: Space toggles it instead of starting a take. */
export default function PreviewToggle({ hidden, onChange }: { hidden: boolean; onChange(hidden: boolean): void }) {
  return (
    <button
      type="button"
      className="preview-toggle"
      data-keeps-space
      aria-label={hidden ? 'Önizlemeyi göster' : 'Önizlemeyi gizle'}
      aria-pressed={hidden}
      onClick={() => onChange(!hidden)}
    >
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
        <circle cx="12" cy="12" r="3" />
        {hidden && <path d="M4 4l16 16" />}
      </svg>
    </button>
  )
}
