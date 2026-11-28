/** Lower-case hex SHA-256 of a blob or string (whole file in memory; fine for MP3s and covers). */
export async function sha256Hex(data: Blob | string): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(await readBytes(data))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function readBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(r.result as ArrayBuffer)
    r.onerror = () => reject(r.error)
    r.readAsArrayBuffer(blob)
  })
}

/** Recording id = first 32 hex chars of sha256(songId + '/' + fileName) (same formula as the server). */
export async function recordingId(songId: string, fileName: string): Promise<string> {
  return (await sha256Hex(`${songId}/${fileName}`)).slice(0, 32)
}
