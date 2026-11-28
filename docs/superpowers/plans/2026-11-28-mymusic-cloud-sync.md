# MyMusic Cloud Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recording row actions, hide-preview, user-chosen light color; a self-hosted Node/SQLite server at music.emiraksu.me (library, files, recordings with MP4 transcode, share links, phone page); and a client sync engine so Windows and Mac share one library.

**Architecture:** Three phases. (1) Small app features. (2) `server/` package: Node 22 + TypeScript + Fastify-free plain `node:http` router or Hono (builder's call, keep deps small) + `better-sqlite3`, ffmpeg in Docker, behind the user's Caddy. (3) Client `src/cloud/*`: API client with 32 MB chunked uploads, a pure merge module, and a sync loop wired into `useLibrary`, storage and the recordings list. Shared wire types live in `shared/api.ts`, imported by both sides.

**Tech Stack:** existing Vite/React/TS/Vitest; server: Node 22, TypeScript, better-sqlite3, ffmpeg/ffprobe, Vitest; Docker + compose; Caddy.

**Spec:** `docs/superpowers/specs/2026-11-28-mymusic-cloud-sync-design.md` (read the "Kurucu kontrolünden sonra eklenen kararlar" section — binding).

## Global Constraints

- Server: listens `0.0.0.0:8120` in the container, published `127.0.0.1:8120`; data under `/data` (`db.sqlite`, `files/`); env: `OWNER_PASSWORD`, `SIGNING_SECRET`, `PUBLIC_URL` (default `https://music.emiraksu.me`), `ALLOWED_ORIGINS` (default `https://overflow-sudo.github.io,http://localhost:5173,http://localhost:5174`), `MAX_UPLOAD_BYTES` (default 4294967296). Secrets never logged, never in repo (`.env.example` only).
- Auth: `POST /api/login {password}` → `{token}` (32 random bytes base64url, stored hashed SHA-256); `Authorization: Bearer <token>` for `/api/*` except login/health; phone page uses the same token in cookie `mm_session` (`HttpOnly; Secure; SameSite=Lax; Path=/`). Failed logins: max 10 per IP per 15 min → 429.
- Chunked upload: 32 MiB parts (`33554432` bytes). `POST /api/uploads` → `{uploadId}`; `PUT /api/uploads/:id/:n` (n from 0); `POST /api/uploads/:id/complete` with body `{ target: 'recording' | 'track' | 'cover', songId, ...meta }`. Incomplete uploads deleted after 24 h. Any failure → client restarts that file from part 0.
- Recording id = first 32 hex chars of `sha256(songId + '/' + fileName)`.
- Song merge: per song, larger `updatedAt` wins (ISO string compare after `Date.parse`); tombstone = song with `deletedAt`. Equal `updatedAt` → take the record, but for `cover` and `track.hash` prefer the non-empty side. Automatic patches (cover backfill, hash backfill) do NOT change `updatedAt`.
- Device-only (never synced): `library.settings`, light prefs, device choices, cloud token, preview-hidden flag. Synced: songs (incl. `chords`, `cover`, `track` with `hash`, `lightColor`, `deletedAt`).
- Sync order every pass: library → tracks/covers → recording deletes → recording uploads. No uploads while a take is counting in, recording or finalizing.
- Share URL: `${PUBLIC_URL}/r/<token>` (token ≥ 22 chars base64url); share page shows only that recording (title, artist, cover, player, İndir) with `<meta name="robots" content="noindex">`. Tracks are never reachable without the Bearer token.
- Signed media URLs: `/files/rec/:id?exp=<unix>&sig=<hex>` with `sig = HMAC-SHA256(SIGNING_SECRET, id + '.' + exp)`, 1 h validity.
- Transcode: video → MP4 `-c:v libx264 -preset veryfast -crf 23 -c:a aac -b:a 192k -movflags +faststart`; ses → M4A `-c:a aac -b:a 192k`; one job at a time; status `processing|ready|failed`.
- Light color: global pref `mm.lightColor` = `'auto'` | `#rrggbb` (localStorage); song override `song.lightColor?: '#rrggbb'`; presets: `#3b82f6 #8b5cf6 #ec4899 #ef4444 #f97316 #eab308 #22c55e #14b8a6`. Fixed color → hue from hex; saturation floor 40%; in fixed mode guitar level changes brightness only, not hue.
- All UI text Turkish. Existing tests keep their assertions.

## Review Focus

1. Recording never lost: a failed/partial upload never deletes the local file; only an explicit Sil or a server tombstone deletes it (Task 11 tests).
2. Share link leaks: `/r/<token>` and its file route expose nothing but that recording; tracks/other recordings/list 401 without Bearer (Task 7 tests).
3. Opening the app on machine B must not overwrite machine A's edits (auto patches keep `updatedAt`) (Task 10 tests).
4. Sync never runs uploads during a take and never blocks the UI; network errors → status line only (Task 11 tests).
5. Token/password never appear in URLs, logs, or the repo (Task 4/9 tests + review).

---

## Phase 1 — app features

### Task 1: User-chosen light color
**Files:** `src/light/lightPrefs.ts` (add `getLightColor/setLightColor/onLightColorChange`), `src/light/lightMath.ts` (`hexToHue(hex): number`, `hueFor(bpm, level, color)`), `src/ui/LightLayer.tsx`, `src/ui/useSongLight.ts`, `src/domain/types.ts` + `library.ts` (`lightColor` kept only if `/^#[0-9a-f]{6}$/i`), `src/ui/LightColorPicker.tsx` (8 swatches + `<input type="color">` + "Otomatik"), `src/ui/SettingsDialog.tsx`, song drawer in `src/ui/SongDetail.tsx` ("Bu şarkının rengi": Genel / swatches); tests.
- [ ] Tests first: `hexToHue('#ef4444')≈0`, `('#3b82f6')≈217`, `('#22c55e')≈142`; fixed color → `--beat-h` constant while level changes; song override beats global; invalid stored color → 'auto'; library drops bad `lightColor`. RED → implement → GREEN → commit `feat: choose light color`.

### Task 2: Hide preview while recording
**Files:** `src/ui/Recorder.tsx` (or a small `PreviewToggle.tsx`), `src/ui/SongDetail.tsx` (when hidden and chords exist, chords take the stage area), `src/ui/app.css`; localStorage `mm.previewHidden`; tests.
- [ ] Tests first: toggle (aria-label "Önizlemeyi gizle"/"Önizlemeyi göster", `aria-pressed`) hides the `<video>` but camera tracks stay live and a take still includes video; not shown in ses mode; persisted. Screenshot 1280 with chords + hidden preview. Commit `feat: hide camera preview`.

### Task 3: Recording row actions (local)
**Files:** `src/ui/RecordingList.tsx` (+ `RecordingActions.tsx`), `src/storage/repo.ts` (`deleteRecording(root, song, fileName)`), tests.
- [ ] Tests first: İndir creates an `<a download="<fileName>">` from the local blob and revokes the URL; Sil asks in-page confirm "Bu kayıt silinsin mi?" (no window.confirm) and deletes the file, list refreshes; Paylaş not rendered yet (cloud absent). Icon buttons with Turkish aria-labels. Commit `feat: download and delete recordings`.

## Phase 2 — server

### Task 4: Server scaffold, config, DB, auth
**Files:** `server/package.json`, `server/tsconfig.json`, `server/src/{config,db,auth,http,main}.ts`, `shared/api.ts`, `server/test/*`. Schema (SQLite): `tokens(hash PK, created_at)`, `songs(id PK, json, updated_at, deleted_at)`, `files(song_id, kind 'track'|'cover', path, hash, size, mime, PK(song_id,kind))`, `recordings(id PK, song_id, kind, recorded_at, file_name, size, duration_sec, status, orig_path, out_path, song_title, song_artist, share_token UNIQUE NULL)`, `recording_tombstones(id PK, deleted_at)`, `uploads(id PK, created_at, parts, bytes)`, `login_attempts(ip, at)`.
- [ ] Tests first: health 200; login wrong → 401, right → token; 11th failed login in window → 429; Bearer required on `/api/library` (401 without); CORS allows listed origins, rejects others; token not logged (spy on logger). Commit `feat(server): scaffold, db, auth`.

### Task 5: Library + chunked uploads + track/cover files
**Files:** `server/src/{library,uploads,files}.ts`; tests.
- [ ] Tests first: PUT song newer wins, older ignored (response = stored); tombstone stored and returned; deleting song removes its track/cover files; upload 3 parts + complete(track) stores file with sha256 and returns hash; complete for unknown song → 409; part beyond MAX_UPLOAD_BYTES → 413; GET track requires Bearer; stale uploads cleaned after 24 h (fake clock). Commit `feat(server): library and files`.

### Task 6: Recordings, tombstones, signed URLs, transcode
**Files:** `server/src/{recordings,transcode,signing}.ts`; tests (ffmpeg runner injected; one optional real-ffmpeg test skipped when ffmpeg missing).
- [ ] Tests first: complete(recording) idempotent by id; list includes tombstones as `{id, deleted:true}`; DELETE removes files + adds tombstone; re-upload of a tombstoned id → 410; `/api/recordings/:id/url` → signed URL; valid sig streams with Range support; expired/bad sig → 403; transcode queue runs one at a time, sets ready/failed, url prefers MP4 when ready. Commit `feat(server): recordings and transcode`.

### Task 7: Share pages + phone page
**Files:** `server/src/{share,pages}.ts`, `server/public/{index.html,app.js,app.css}`; tests.
- [ ] Tests first: POST share returns stable URL; DELETE share → `/r/<token>` 404; share page HTML has title/artist, noindex, player pointing at `/r/<token>/file` (Range ok); `/r/<token>/file` can't fetch other recordings or tracks; phone page `/` login sets cookie, lists recordings grouped by song incl. "Silinen şarkılar", logout clears cookie. Commit `feat(server): share and phone pages`.

### Task 8: Packaging + install guide
**Files:** `server/Dockerfile` (node:22-bookworm-slim + ffmpeg, non-root user, healthcheck), `server/compose.yaml` (service `mymusic`, `127.0.0.1:8120:8120`, volume `./data:/data`, `env_file: .env`, restart unless-stopped), `server/.env.example`, `server/mymusic.caddy`, `server/KURULUM.md` (Turkish, copy-paste steps: DNS kaydı `music` (Cloudflare kullanılıyorsa proxy açık/kapalı ikisi de çalışır), repo klonla, `.env` oluştur (`openssl rand` ile), `docker compose up -d --build`, Caddy dosyası + `caddy validate` + `systemctl reload caddy`, `curl https://music.emiraksu.me/api/health`, güncelleme ve yedekleme), root `README.md` cloud section; `.dockerignore`.
- [ ] Build check in sandbox if Docker available; else `npm run build` + run server locally with a temp data dir and hit health/login. Commit `chore(server): docker, caddy, install guide`.

## Phase 3 — client sync

### Task 9: Cloud settings + API client
**Files:** `src/cloud/{api,session,chunkedUpload}.ts`, `src/ui/CloudSettings.tsx` (in SettingsDialog: adres, şifre, Bağlan, durum, Şimdi eşitle, Çıkış yap); tests.
- [ ] Tests first: login stores token (localStorage `mm.cloud`), never the password; 401 → status "Giriş gerekli"; chunked upload splits a 70 MB blob into 3 parts and completes; a part failure retries from part 0 once per sync pass then reports; fetch errors → "Çevrimdışı". Commit `feat: cloud connection`.

### Task 10: Library merge + sync loop
**Files:** `src/cloud/merge.ts` (pure), `src/cloud/syncLibrary.ts`, `src/state/useLibrary.ts` (`patchSong(id, patch, { auto?: boolean })`; delete → tombstone; hide `deletedAt` songs from consumers), `src/cover/useCovers.ts` (auto patches), `src/domain/library.ts` (`deletedAt`, `pendingDeletes` accepted); tests.
- [ ] Tests first: merge newer wins both directions; tombstone beats older edit; equal updatedAt keeps non-empty cover/hash; auto patch keeps updatedAt; first sync with empty local adopts server; sync debounced 2 s after a change and every 60 s; UI never sees deleted songs. Commit `feat: library sync`.

### Task 11: File + recording sync
**Files:** `src/cloud/{syncFiles,syncRecordings}.ts`, `src/storage/{repo,cover}.ts` (hash on import), `src/ui/App.tsx` / a `useCloudSync` hook (runs passes; pauses during takes via existing busy flag); tests.
- [ ] Tests first: missing local track downloaded and written; local newer track uploaded; 404/hash mismatch → retry later (no error); recordings missing on server uploaded one at a time; nothing uploaded while busy; server tombstone deletes local recording file and never re-uploads; local Sil offline → `pendingDeletes` → sent when online; failed upload leaves local file untouched. Commit `feat: file and recording sync`.

### Task 12: Merged recordings list + cloud actions + README
**Files:** `src/ui/RecordingList.tsx`, `RecordingActions.tsx` (Paylaş copies link → "Bağlantı kopyalandı", "Paylaşımı kaldır"; Sil confirm text "Bu kayıt bu bilgisayardan ve buluttan silinsin mi?"; İndir server MP4/M4A via signed URL when not local), status icons (☁ / ⇡ / yalnız bu bilgisayarda / yalnız bulutta, with Turkish titles), play from signed URL when not local; README (Turkish cloud usage); tests + screenshots.
- [ ] Tests first per actions/status; screenshots 1280/400. Commit `feat: cloud recordings in the app`.
