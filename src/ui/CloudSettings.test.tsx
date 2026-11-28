import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { markSynced, resetCloudStatus, setCloudStatus } from '../cloud/status'
import SettingsDialog from './SettingsDialog'

const jr = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init })

function setup(fetchImpl: typeof fetch, onSyncNow = vi.fn()) {
  render(<SettingsDialog value={null} onSave={async () => {}} onClose={() => {}} measureAuto={async () => 20} cloudFetch={fetchImpl} onSyncNow={onSyncNow} />)
  return { onSyncNow }
}
const connect = (pw = 'hunter2') => {
  fireEvent.change(screen.getByLabelText('Şifre'), { target: { value: pw } })
  fireEvent.click(screen.getByRole('button', { name: 'Bağlan' }))
}

beforeEach(() => resetCloudStatus())
afterEach(() => { cleanup(); localStorage.clear() })

describe('CloudSettings', () => {
  it('connect success stores token (not password) and shows Bağlı', async () => {
    const f = vi.fn(async () => jr({ token: 'tok-abc' }))
    setup(f as unknown as typeof fetch)
    expect((screen.getByLabelText('Sunucu adresi') as HTMLInputElement).value).toBe('https://music.emiraksu.me')
    connect()
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Bağlı'))
    const raw = localStorage.getItem('mm.cloud')!
    expect(JSON.parse(raw)).toEqual({ baseUrl: 'https://music.emiraksu.me', token: 'tok-abc' })
    expect(raw).not.toContain('hunter2')
    expect(screen.getByLabelText('Şifre')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Çıkış yap' })).toBeInTheDocument()
  })

  it('wrong password shows Şifre yanlış. and stores nothing', async () => {
    setup((async () => jr({ error: 'Wrong password' }, { status: 401 })) as unknown as typeof fetch)
    connect('nope')
    expect(await screen.findByRole('alert')).toHaveTextContent('Şifre yanlış.')
    expect(localStorage.getItem('mm.cloud')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Bağlı değil')
  })

  it('status line shows the last error and the last sync time', () => {
    localStorage.setItem('mm.cloud', JSON.stringify({ baseUrl: 'https://music.emiraksu.me', token: 't' }))
    setup(vi.fn() as unknown as typeof fetch)
    const at = '2026-11-28T09:05:00.000Z'
    act(() => { markSynced(at); setCloudStatus('offline', 'Sunucuya ulaşılamadı.') })
    const hhmm = new Date(at).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    const status = screen.getByRole('status')
    expect(status).toHaveTextContent('Çevrimdışı · Sunucuya ulaşılamadı.')
    expect(status).toHaveTextContent(`Son eşitleme: ${hhmm}`)
  })

  it('429 shows the wait message', async () => {
    setup((async () => jr({ error: 'x' }, { status: 429, headers: { 'Retry-After': '900' } })) as unknown as typeof fetch)
    connect()
    expect(await screen.findByRole('alert')).toHaveTextContent('Çok fazla deneme, biraz bekle')
  })

  it('network failure shows an unreachable message', async () => {
    setup((async () => { throw new TypeError('Failed to fetch') }) as unknown as typeof fetch)
    connect()
    expect(await screen.findByRole('alert')).toHaveTextContent('Sunucuya ulaşılamadı.')
  })

  it('rejects an insecure address without calling the server', () => {
    const f = vi.fn()
    setup(f as unknown as typeof fetch)
    fireEvent.change(screen.getByLabelText('Sunucu adresi'), { target: { value: 'http://example.com' } })
    connect()
    expect(screen.getByRole('alert')).toHaveTextContent('Geçersiz sunucu adresi')
    expect(f).not.toHaveBeenCalled()
  })

  it('stored session shows Bağlı; Şimdi eşitle calls onSyncNow; Çıkış yap clears the token', () => {
    localStorage.setItem('mm.cloud', JSON.stringify({ baseUrl: 'https://music.emiraksu.me', token: 't' }))
    const { onSyncNow } = setup(vi.fn() as unknown as typeof fetch)
    expect(screen.getByRole('status')).toHaveTextContent('Bağlı')
    fireEvent.click(screen.getByRole('button', { name: 'Şimdi eşitle' }))
    expect(onSyncNow).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Çıkış yap' }))
    expect(localStorage.getItem('mm.cloud')).toBeNull()
    expect(screen.getByRole('status')).toHaveTextContent('Bağlı değil')
    expect(screen.queryByRole('button', { name: 'Çıkış yap' })).toBeNull()
  })

  it('Enter in the password field connects instead of saving settings', async () => {
    const f = vi.fn(async () => jr({ token: 't' }))
    setup(f as unknown as typeof fetch)
    fireEvent.change(screen.getByLabelText('Şifre'), { target: { value: 'pw' } })
    fireEvent.keyDown(screen.getByLabelText('Şifre'), { key: 'Enter' })
    await waitFor(() => expect(f).toHaveBeenCalled())
  })
})
