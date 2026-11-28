import { describe, expect, it } from 'vitest'
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

describe('built server', () => {
  it('serves the phone page and assets from dist', async () => {
    const root = join(import.meta.dirname, '..')
    execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'pipe' })
    const dir = mkdtempSync(join(tmpdir(), 'mm-dist-'))
    const port = 20000 + Math.floor(Math.random() * 20000)
    const child = spawn('node', ['dist/server/src/main.js'], {
      cwd: root, stdio: 'ignore',
      env: { ...process.env, OWNER_PASSWORD: 'dummy-password-123', SIGNING_SECRET: 'dummy-secret-dummy-secret-dummy-secret', DATA_DIR: dir, PORT: String(port) },
    })
    try {
      let ok = false
      for (let i = 0; i < 50 && !ok; i++) {
        try { ok = (await fetch(`http://127.0.0.1:${port}/health`)).ok } catch { await new Promise((r) => setTimeout(r, 100)) }
      }
      expect(ok).toBe(true)
      for (const p of ['/', '/app.js', '/app.css']) expect((await fetch(`http://127.0.0.1:${port}${p}`)).status).toBe(200)
    } finally { child.kill(); rmSync(dir, { recursive: true, force: true }) }
  }, 60000)
})
