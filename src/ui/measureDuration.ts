// MediaRecorder webm files report Infinity until the end is seeked to; seeking far forces the real value.
export function measureDuration(url: string, kind: 'video' | 'ses'): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement(kind === 'video' ? 'video' : 'audio')
    const done = (v: number | null) => {
      el.removeAttribute('src')
      resolve(v)
    }
    el.preload = 'metadata'
    el.onerror = () => done(null)
    el.onloadedmetadata = () => {
      if (el.duration === Infinity) {
        el.ondurationchange = () => {
          if (Number.isFinite(el.duration)) {
            const d = el.duration
            el.currentTime = 0
            done(d)
          }
        }
        el.currentTime = 1e9
      } else done(Number.isFinite(el.duration) ? el.duration : null)
    }
    el.src = url
  })
}
