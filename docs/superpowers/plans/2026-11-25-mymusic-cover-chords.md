# MyMusic Cover & Chords Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add album covers (auto-found via iTunes Search, or user image) and pasted chord sheets shown nicely, including beside the recording stage.

**Architecture:** Pure chord parser + `ChordSheet` component; cover service (`src/cover/itunes.ts`) with fetch→JSONP fallback; cover files stored next to recordings via existing `FsDir`; UI pieces slot into the existing drawer, list rows, song header and recorder layout.

**Tech Stack:** existing Vite + React + TS + Vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-11-25-mymusic-cover-chords-design.md`

## Global Constraints

- Song fields (additive, optional): `cover?: { source: 'itunes' | 'user'; fileName?: string; url?: string }`, `chords?: string`. Old libraries without them stay valid; `parseLibrary` must not reject them; unknown fields still preserved.
- iTunes URL exactly: `https://itunes.apple.com/search?term=${encodeURIComponent(title + ' ' + artist)}&entity=song&limit=1&country=TR`; artwork: replace `100x100` with `600x600` in `artworkUrl100`. JSONP fallback adds `&callback=<name>`; 8 s timeout → null.
- Cover file names: `cover.jpg` (iTunes) / `cover.<ext>` (user, ext lowercased, `[a-z0-9]{1,5}`, else `jpg`); only one `cover.*` per song folder.
- Only title + artist leave the machine. No other network calls added.
- Cover sizes: list 40 px (radius 6), song header 96 px desktop / 64 px ≤ 520 px; placeholder = first letter on `hsl(var(--beat-h) 40% 18%)`.
- Backfill: covers missing on list load are searched with max 2 concurrent; failures not retried in the same session.
- Chords UI: monospace (`ui-monospace, "Cascadia Mono", Consolas, monospace`), ~18 px in recorder; chord tokens colored `hsl(var(--beat-h) 85% 70%)`.
- Recorder layout with chords: ≥ 900 px → grid stage ~62% / chords ~38%, chords panel scrolls independently; < 900 px → chords below stage. No chords → unchanged layout.
- "Akorları ara" opens `https://www.google.com/search?q=${encodeURIComponent(`${title} ${artist} chords`)}` in a new tab (`target="_blank" rel="noopener"`).
- All UI text Turkish. Existing tests keep their assertions.

## Review Focus

1. Lyric lines with words that look like chords ("A day in the life", "Am I", "E bir") must not become chord lines (Task 1 tests).
2. iTunes CORS/JSONP failure, no results, offline → placeholder, no crash, no unhandled rejection (Task 2 tests).
3. A cover fetch finishing after the song was deleted or the user picked their own image must not overwrite (Task 3 test).
4. Space typed inside the chords textarea never starts a take (Task 4 test).
5. Very long chord sheets don't stretch the page or push the record button off screen (Task 4 screenshot).

---

### Task 1: Chord parser + ChordSheet

**Files:** Create `src/chords/parseChords.ts`, `src/ui/ChordSheet.tsx`; Tests `src/chords/parseChords.test.ts`, `src/ui/ChordSheet.test.tsx`.

**Produces:**
```ts
export const CHORD_RE: RegExp; // ^[A-G](#|b)?(m|maj|min|dim|aug|sus|add)?\d{0,2}(sus\d|add\d|maj\d|b\d|#\d)*(\/[A-G](#|b)?)?$
export type ChordLine =
  | { kind: 'chords'; text: string }                         // keep spacing
  | { kind: 'inline'; parts: { chord?: string; text: string }[] } // [Am]text
  | { kind: 'section'; label: string }                       // [Verse], [Chorus 2]
  | { kind: 'lyric'; text: string }
  | { kind: 'blank' };
export function isChord(token: string): boolean;
export function parseChords(src: string): ChordLine[];
export function ChordSheet(p: { text: string; size?: 'sm' | 'lg' }): JSX.Element;
```
Chord line rule: ≥ 1 token, every whitespace-separated token is a chord (also allow `|`, `x2`, `(`, `)` tokens), and if exactly one token it must not be a lone `A`/`E` followed by nothing on a line longer than 1 token — i.e. single-token lines count as chords only if the token is a chord.
- [ ] **Step 1: Failing tests:** `isChord` true for `Am, G, C/E, F#m7, Bbsus4, D/F#, Cmaj7, Gadd9, E7, Dsus2`; false for `Am I`, `Hello`, `Ab-`, `H`. `parseChords("Am  G  C\nHello world")` → `[{chords,'Am  G  C'},{lyric,'Hello world'}]`; `"A day in the life"` → lyric; `"Am I evil"` → lyric; `"E bir gün"` → lyric; `"[Verse]"` → section `Verse`; `"[Am]Hello [G]world"` → inline parts `[{chord:'Am',text:'Hello '},{chord:'G',text:'world'}]`; `"G | C | x2"` → chords; empty line → blank; CRLF handled. ChordSheet renders chord tokens in elements with class `chord` and keeps spacing (`white-space: pre`).
- [ ] **Step 2–4:** RED, implement, GREEN. **Step 5: Commit** `feat: chord parser and chord sheet`.

### Task 2: Cover service + storage + types

**Files:** Create `src/cover/itunes.ts`, `src/storage/cover.ts`; Modify `src/domain/types.ts` (Song.cover, Song.chords), `src/domain/library.ts` (accept/preserve them; reject `cover` that isn't an object or `chords` that isn't a string → treat as corrupt? No: drop invalid optional fields silently); Tests alongside.

**Produces:**
```ts
// itunes.ts
export interface CoverHit { artworkUrl: string }      // already upscaled to 600x600
export function itunesUrl(title: string, artist: string): string;
export async function searchCover(title: string, artist: string, deps?: { fetch?: typeof fetch; jsonp?: (url: string) => Promise<unknown>; timeoutMs?: number }): Promise<CoverHit | null>;
export function jsonp(url: string, timeoutMs?: number): Promise<unknown>; // script-tag JSONP, cleans up global + tag, rejects on timeout/error
// storage/cover.ts
export async function writeCover(root: FsDir, song: Song, data: Blob, ext: string): Promise<string>; // returns file name, removes other cover.*
export async function readCover(root: FsDir, song: Song): Promise<File | null>;
export async function removeCover(root: FsDir, song: Song): Promise<void>;
export async function downloadImage(url: string, f?: typeof fetch): Promise<Blob | null>; // null on any failure
```
- [ ] **Step 1: Failing tests:** `itunesUrl('Wonderwall','Oasis')` exact string; `searchCover` with fake fetch returning `{results:[{artworkUrl100:'https://x/100x100bb.jpg'}]}` → `https://x/600x600bb.jpg`; fetch rejects (TypeError, CORS) → falls back to injected jsonp; no results → null; jsonp timeout → null; no unhandled rejection. Storage: write `cover.jpg` then user `cover.PNG` → only `cover.png` remains; readCover missing → null. Library: song with `cover` and `chords` round-trips; `chords: 5` dropped, song kept.
- [ ] **Step 2–4:** RED, implement, GREEN. **Step 5: Commit** `feat: cover search and storage`.

### Task 3: Cover UI (list, header, drawer, auto + backfill)

**Files:** Create `src/ui/CoverArt.tsx`, `src/cover/useCovers.ts`; Modify `src/ui/SongList.tsx` (40 px cover at row start), `src/ui/SongDetail.tsx` (96/64 px cover left of title; drawer **Kapak** section first: preview, "Kapağı yeniden bul", "Kendi resmini seç", "Kaldır", status line "Kapak bulunamadı."), `src/App.tsx` (after `addSong`, trigger find; run backfill on list load); Tests.

**Produces:** `<CoverArt root song size />` (reads `cover.fileName` via readCover → object URL, revoked; or `cover.url`; else placeholder letter). `useCovers(root, songs, patchSong)` → `{ findCover(song): Promise<'found'|'none'>, setUserCover(song, file), removeCover(song) }` and backfill (max 2 concurrent, session-level failed set). Before patching, re-check the song still exists and `cover` is still absent or still `itunes` (Review Focus 3).
- [ ] **Step 1: Failing tests:** placeholder shows first letter; file cover shows `<img>` with object URL and revokes on unmount; adding a song triggers one search; backfill with 5 coverless songs never runs >2 at once; failed song not retried on re-render; find resolving after user picked own image doesn't overwrite; "Kaldır" removes file and field; drawer buttons exist with Turkish names.
- [ ] **Step 2–4:** RED, implement, GREEN.
- [ ] **Step 5:** Screenshot list + song screen (fake fetch impossible in browser → seed a cover file into OPFS folder in the script). **Commit** `feat: album covers`.

### Task 4: Chords UI (drawer, recorder layout) + README

**Files:** Modify `src/ui/SongDetail.tsx` (drawer **Akorlar** section: monospace textarea saved on blur via patch path, "Akorları ara" link), `src/ui/Recorder.tsx` or SongDetail stage area (grid with `<ChordSheet size="lg">` when `song.chords`), `src/ui/app.css`, `README.md` (Turkish: kapak, akorlar, gizlilik notu); Tests.
- [ ] **Step 1: Failing tests:** typing chords + blur saves `chords`; failed save shows "Kaydedilemedi, tekrar dene."; "Akorları ara" href exact; song with chords renders ChordSheet next to the stage, without chords no chords panel; Space inside the textarea doesn't start a take.
- [ ] **Step 2–4:** RED, implement, GREEN; full suite + build.
- [ ] **Step 5:** Screenshots 1280×800 and 400×800 with a long chord sheet: page doesn't scroll sideways, record button visible without scrolling at 1280. **Commit** `feat: chords on the song screen`.
