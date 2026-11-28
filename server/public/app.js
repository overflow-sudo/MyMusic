'use strict'
const app = document.getElementById('app')
const state = { data: null, open: null, urls: {}, shareUrl: {}, timer: 0 }

function el(tag, props, ...kids) {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') n.className = v
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v)
    else n[k] = v
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid)
  return n
}

async function call(method, path, body) {
  const r = await fetch(path, {
    method, credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (r.status === 401) { state.data = null; showLogin(); throw new Error('login') }
  if (!r.ok) throw new Error(String(r.status))
  return r.status === 204 ? null : r.json()
}

function showLogin(message) {
  clearTimeout(state.timer)
  const err = el('p', { class: 'error', role: 'alert' }, message || '')
  const pw = el('input', { type: 'password', placeholder: 'Şifre', autocomplete: 'current-password', required: true })
  const form = el('form', { class: 'login', onsubmit: async (e) => {
    e.preventDefault()
    err.textContent = ''
    const r = await fetch('/session', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw.value }),
    }).catch(() => null)
    if (r && r.ok) return load()
    err.textContent = !r ? 'Bağlanılamadı.' : r.status === 429 ? 'Çok fazla deneme. Biraz sonra tekrar dene.' : 'Şifre yanlış.'
  } }, el('h1', {}, 'MyMusic'), pw, el('button', { class: 'primary', type: 'submit' }, 'Giriş yap'), err)
  app.replaceChildren(form)
}

async function load() {
  try { state.data = await call('GET', '/m/recordings') } catch (e) {
    if (e.message !== 'login') app.replaceChildren(el('p', { class: 'error' }, 'Liste alınamadı.'))
    return
  }
  render()
  clearTimeout(state.timer)
  if (state.data.recordings.some((r) => r.status === 'processing')) state.timer = setTimeout(load, 10000)
}

const fmtDate = (iso) => new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
function fmtDur(s) {
  if (s == null) return '—'
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`
}

function groups() {
  const { recordings, songs } = state.data
  const by = new Map()
  let deleted = []
  for (const r of recordings) {
    if (!songs[r.songId]) { deleted.push(r); continue }
    if (!by.has(r.songId)) by.set(r.songId, [])
    by.get(r.songId).push(r)
  }
  const out = [...by.entries()].map(([id, recs]) => ({ song: songs[id], recs }))
  out.sort((a, b) => b.recs[0].recordedAt.localeCompare(a.recs[0].recordedAt))
  if (deleted.length) out.push({ song: null, recs: deleted })
  return out
}

function render() {
  const gs = groups()
  const body = gs.length ? gs.map(groupView) : [el('p', { class: 'dim' }, 'Henüz kayıt yok.')]
  app.replaceChildren(
    el('div', { class: 'bar' }, el('h1', {}, 'Kayıtlar'), el('button', { class: 'quiet', onclick: logout }, 'Çıkış yap')),
    ...body,
  )
}

function groupView({ song, recs }) {
  const head = song
    ? [song.hasCover ? el('img', { class: 'cover', src: `/m/songs/${encodeURIComponent(song.id)}/cover`, alt: '', loading: 'lazy' }) : el('div', { class: 'ph' }),
       el('div', { class: 'titles' }, el('h2', {}, song.title || 'Adsız'), el('p', { class: 'dim' }, song.artist))]
    : [el('div', { class: 'ph' }), el('div', { class: 'titles' }, el('h2', {}, 'Silinen şarkılar'))]
  return el('section', { class: 'group' }, el('div', { class: 'group-head' }, head), recs.map((r) => recView(r, !song)))
}

function recView(r, showSong) {
  const processing = r.status === 'processing'
  const status = processing ? el('span', { class: 'status-processing' }, 'Hazırlanıyor…')
    : r.status === 'failed' ? el('span', { class: 'status-failed' }, 'Dönüştürülemedi') : el('span', {}, 'Hazır')
  const main = el('button', { class: 'rec-main', disabled: processing, onclick: () => play(r.id) },
    el('span', {}, el('span', {}, fmtDate(r.recordedAt)),
      el('br'), el('span', { class: 'rec-meta' }, `${r.kind === 'video' ? 'Video' : 'Ses'} · ${fmtDur(r.durationSec)}${showSong ? ' · ' + (r.songTitle || '') : ''}`)),
    status)
  const row = el('div', { class: 'rec' }, main)
  if (state.open === r.id && state.urls[r.id]) {
    row.append(el(r.kind === 'video' ? 'video' : 'audio', { src: state.urls[r.id], controls: true, autoplay: true, playsInline: true, preload: 'metadata' }))
  }
  const actions = el('div', { class: 'actions' },
    el('button', { onclick: () => share(r) }, 'Paylaş'),
    r.shared ? el('button', { class: 'quiet', onclick: () => unshare(r) }, 'Paylaşımı kaldır') : null,
    processing ? null : el('button', { class: 'quiet', onclick: () => download(r.id) }, 'İndir'),
    el('button', { class: 'quiet', onclick: () => remove(r) }, 'Sil'))
  row.append(actions)
  if (state.shareUrl[r.id]) row.append(el('input', { class: 'share-url', type: 'text', readOnly: true, value: state.shareUrl[r.id], onfocus: (e) => e.target.select() }))
  return row
}

async function play(id) {
  try { state.urls[id] = (await call('GET', `/m/recordings/${id}/url`)).url } catch { return }
  state.open = id
  render()
}

async function download(id) {
  try { location.href = (await call('GET', `/m/recordings/${id}/url?download=1`)).url } catch { /* ignored */ }
}

async function share(r) {
  let url
  try { url = (await call('POST', `/m/recordings/${r.id}/share`)).url } catch { return }
  r.shared = true
  state.shareUrl[r.id] = url
  if (navigator.share) {
    try { await navigator.share({ title: r.songTitle || 'Kayıt', url }) } catch { /* cancelled */ }
  } else if (navigator.clipboard) {
    try { await navigator.clipboard.writeText(url) } catch { /* the visible field below is the fallback */ }
  }
  render()
}

async function remove(r) {
  if (!confirm('Bu kayıt buluttan silinsin mi?')) return
  try { await call('DELETE', `/m/recordings/${r.id}`) } catch { return }
  state.data.recordings = state.data.recordings.filter((x) => x.id !== r.id)
  delete state.shareUrl[r.id]; delete state.urls[r.id]
  if (state.open === r.id) state.open = null
  render()
}

async function unshare(r) {
  try { await call('DELETE', `/m/recordings/${r.id}/share`) } catch { return }
  r.shared = false
  delete state.shareUrl[r.id]
  render()
}

async function logout() {
  clearTimeout(state.timer)
  try { await call('POST', '/session/logout') } catch { /* already out */ }
  state.open = null; state.urls = {}; state.shareUrl = {}
  showLogin()
}

load()
