# MyMusic UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle MyMusic into a Tesla-like dark minimal UI with a rhythm-driven light layer (modes A / C / Off), move song settings into a ⚙ drawer, and add a shared seekable player for recordings and the backing track ("Buradan başla").

**Architecture:** Function is unchanged. A tiny `src/light` module (pure math + prefs + a pub-sub "light bus") is fed by the engine's new optional `onBeatPlan` hook and by LevelMeter's level; a `LightLayer` component turns the bus into CSS variables on a rAF loop. Styling moves to tokens in `app.css`. A shared `Player` replaces the bare `<audio>/<video controls>` and a `mediaCoordinator` keeps one medium playing at a time.

**Tech Stack:** existing Vite + React + TS + Vitest. Google Fonts (Space Grotesk 300/500, Inter 400/500/600) linked in `index.html`. No new runtime deps.

**Spec:** `docs/superpowers/specs/2026-11-24-mymusic-ui-redesign-design.md` (and the original `2026-11-24-mymusic-design.md` for unchanged behaviour).

## Global Constraints

- Single dark look. Tokens exactly: `--bg #0b0c0e`, `--panel #131519`, `--line #22252b`, `--fg #eceef1`, `--dim #8a8f98`, `--rec #e8433a`; light vars `--beat-h` (hue), `--beat-a` (0..1 pulse), `--lvl` (0..1). Display font Space Grotesk 300, body Inter; fallbacks `system-ui, "Segoe UI", sans-serif`.
- Buttons/segments fully rounded (999px); stage radius 14px; dividers 1px `--line`. No browser-default grey controls remain; no English UI text ("Choose File" replaced by "Parça seç").
- Light modes: `'a' | 'c' | 'off'`, default `'a'`, stored in localStorage key `mm.light` (try/catch). `prefers-reduced-motion: reduce` → static glow (no pulsing).
- Hue from BPM: 60 → 230, ≥160 → 15, linear between, clamped; guitar level shifts hue by up to +30 and raises brightness. Level mapping −60…0 dB → 0…1 (clamped).
- Beat source: during a take, phase from the take's `ctx.currentTime` against `clickTimes` then `downbeat + n·60/bpm`; idle on song screen: free-running `performance.now()` at song BPM; list screen: slow breath (period 6 s), no beats. Track preview in the drawer does not drive the light.
- Light only reads: no audio-graph nodes added, no timing change. `startTake` gains only an optional `onBeatPlan` callback; all existing engine tests stay green unchanged.
- Song screen opens in **ses** mode with the mic preview auto-acquired; video on demand.
- One medium at a time; starting a take pauses all players. Space on player controls (inside `[data-player]`) never triggers record shortcuts.
- Seek step 5 s. Recording during-take seek: none.
- Existing behaviour tests are preserved; selectors/text queries may be updated to the new markup.
- All UI text Turkish.

## Review Focus

1. Light makes text unreadable (mode C at high level) → text keeps contrast: C background lightness capped at 24%.
2. Mic permission denied on auto-open → song screen still usable, light just pulses, clear Turkish message (Task 6 test).
3. Space while a Player control is focused → toggles playback only, no take (Task 4 test).
4. `Infinity`-duration webm in Player → progress bar and total time work after the duration fix; seeking doesn't throw (Task 4 test with fake media).
5. Drawer closed while a device change or edit save is pending → no lost state; Recorder stays mounted (Task 5 test).

---

### Task 1: Light core (pure math, prefs, bus)

**Files:** Create `src/light/lightMath.ts`, `src/light/lightPrefs.ts`, `src/light/lightBus.ts`; Tests alongside.

**Interfaces — Produces:**
```ts
// lightMath.ts
export function hueForBpm(bpm: number): number;                 // 60→230, ≥160→15, clamp below 60 → 230
export function levelFromDb(db: number): number;                 // −60…0 → 0…1 clamped
export function pulseFromPhase(phase: number): number;           // (1-phase)^3, phase in [0,1)
export interface TakeBeatPlan { clickTimes: number[]; downbeat: number; bpm: number }
export function takePhase(now: number, p: TakeBeatPlan): number | null; // phase within current beat; null before first click
export function freePhase(nowMs: number, bpm: number): number;
export function breath(nowMs: number): number;                   // 0..1 sine, period 6000 ms
// lightPrefs.ts
export type LightMode = 'a' | 'c' | 'off';
export function getLightMode(): LightMode;                       // default 'a'; invalid stored value → 'a'
export function setLightMode(m: LightMode): void;
export function onLightModeChange(cb: (m: LightMode) => void): () => void;
// lightBus.ts
export type BeatSource =
  | { kind: 'breath' }
  | { kind: 'free'; bpm: number }
  | { kind: 'take'; ctx: { currentTime: number }; plan: TakeBeatPlan };
export const lightBus: {
  setLevel(v: number): void; getLevel(): number;
  setSource(s: BeatSource): void; getSource(): BeatSource;   // default { kind: 'breath' }
  setHueBpm(bpm: number | null): void; getHueBpm(): number | null;
};
```
- [ ] **Step 1: Failing tests:** `hueForBpm(60)=230`, `(160)=15`, `(110)=122.5`, `(40)=230`, `(200)=15`; `levelFromDb(-60)=0`, `(0)=1`, `(-30)=0.5`, `(-90)=0`; `pulseFromPhase(0)=1`, `(0.5)=0.125`; `takePhase(9.9,{clickTimes:[10.1,10.6],downbeat:11.1,bpm:120})=null`, `takePhase(10.35,…)≈0.5`, `takePhase(11.35,…)≈0.5` (after downbeat at 0.5 s beats); `freePhase(250,120)≈0.5`; `breath(0)` and `breath(6000)` equal; prefs: default `'a'`, stored `'x'` → `'a'`, set then get round-trips, `setLightMode` notifies subscribers, localStorage throwing → default and no throw.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `feat: light core (math, prefs, bus)`.

### Task 2: Feed the bus (engine hook + LevelMeter)

**Files:** Modify `src/audio/engine.ts` (TakeOptions), `src/ui/LevelMeter.tsx`; Tests `src/audio/engine.test.ts` (add), `src/ui/LevelMeter.test.tsx` (new).

**Interfaces — Consumes:** Task 1. **Produces:** `TakeOptions.onBeatPlan?(p: { ctx: BaseAudioContext; plan: TakeBeatPlan }): void` called once right after the count-in is scheduled, with `planCountIn`'s `clickTimes`/`downbeat` and the song's bpm. LevelMeter calls `lightBus.setLevel(levelFromDb(db))` each frame and `setLevel(0)` on unmount.
- [ ] **Step 1: Failing tests:** engine: with `onBeatPlan` spy, bpm 120, beats 4, ctx time 10 → called once with `plan.clickTimes [10.1,10.6,11.1,11.6]`, `downbeat 12.1`, `bpm 120`; without it, all existing engine tests unchanged. LevelMeter (fake AnalyserNode returning a fixed RMS): bus level becomes the mapped value; unmount → 0.
- [ ] **Step 2–4:** RED, implement, GREEN. **Step 5: Commit** `feat: engine beat-plan hook and level publishing`.

### Task 3: Visual foundation + LightLayer + list screen

**Files:** Modify `index.html` (fonts), rewrite `src/ui/app.css` (tokens, base controls: `.btn`, `.btn-ghost`, `.seg`, `.icon-btn`, inputs with underline, `.stage`), Create `src/ui/LightLayer.tsx`, Modify `src/App.tsx` (header: tabs left, "＋ Şarkı" and "⚙" right; mount `<LightLayer>` once at root), `src/ui/SongList.tsx`, `src/ui/SongForm.tsx`, `src/ui/FolderGate.tsx`, `src/ui/BrokenLibrary.tsx`, `src/ui/Unsupported.tsx`; Test `src/ui/LightLayer.test.tsx`, update existing UI tests' queries only where markup changed.

**Interfaces — Consumes:** Task 1. **Produces:** `<LightLayer />` — fixed full-viewport layer behind content (`z-index:-1`, `pointer-events:none`), class `light-a` / `light-c` / hidden for off, sets `--beat-h`, `--beat-a`, `--lvl` on `document.documentElement` every rAF from `lightBus` (+ `breath` / `freePhase` / `takePhase` per source; hue from `getHueBpm()` or 205 when null, + `lvl*30`). Mode A: radial gradient from bottom per draft; Mode C: full linear gradient with lightness ≤ 24%. Reduced motion: no rAF, `--beat-a 0.3`, `--lvl 0`.
List row per spec: title + dim artist; right: large BPM digits + "BPM · N kayıt" or "—". Tabs as plain text buttons "Çalıştığım N" / "Bildiğim N" (selected = `--fg`, others `--dim`). Search: underline input, placeholder "Ara".
- [ ] **Step 1: Failing tests:** LightLayer: mode `'off'` renders nothing visible (`hidden`); mode change via `setLightMode('c')` switches class; with fake rAF and source `{kind:'free',bpm:120}` at t=0 → `--beat-a` = `1.000`; reduced-motion matchMedia → no rAF scheduled and `--beat-a` = `0.3`. Existing SongList/FolderGate tests still pass (update queries if needed).
- [ ] **Step 2–4:** RED, implement, GREEN; `npm run build` OK.
- [ ] **Step 5:** Screenshot check with Playwright (fake picker via OPFS as in earlier manual check) of list screen at 1280×800 and 400×800; no horizontal scroll. **Commit** `feat: dark minimal theme, light layer, list screen`.

### Task 4: Shared Player + media coordinator + recordings list

**Files:** Create `src/ui/Player.tsx`, `src/ui/mediaCoordinator.ts`; Modify `src/ui/RecordingList.tsx` (use Player; drop bare controls), `src/audio/shortcuts.ts` (`isTypingTarget` true for elements inside `[data-player]`); Tests `src/ui/Player.test.tsx`, `src/ui/mediaCoordinator.test.ts`, update `src/audio/shortcuts.test.ts`, `src/ui/SongDetail.test.tsx` if affected.

**Interfaces — Produces:**
```ts
// mediaCoordinator.ts
export function claimPlayback(el: HTMLMediaElement): void; // pauses every other registered element
export function register(el: HTMLMediaElement): () => void;
export function pauseAll(): void;
// Player.tsx
export interface PlayerProps { src: string; kind: 'audio' | 'video'; autoPlay?: boolean; onTime?(sec: number): void; extra?: ReactNode }
export default function Player(p: PlayerProps): JSX.Element; // root has data-player; controls: ⏮5 (−5 s), play/pause, 5⏭ (+5 s), range seek, "m:ss / m:ss"
```
Duration: if `duration === Infinity`, seek to 1e9, read on `durationchange`, reset to 0 (move/reuse `measureDuration`). Seek clamps to [0, duration]. Space/Enter on its buttons act natively; Space with focus on the range toggles play.
- [ ] **Step 1: Failing tests:** coordinator: two registered fake media, `claimPlayback(a)` pauses b; `pauseAll` pauses both. Player (fake HTMLMediaElement props): +5 at 3 s → 8; −5 at 3 s → 0; seek beyond duration clamps; Infinity duration shows real total after `durationchange`; play calls `claimPlayback`. Shortcuts: target inside `[data-player]` → `isTypingTarget` true; Recorder test: Space on a focused Player button doesn't start a take.
- [ ] **Step 2–4:** RED, implement, GREEN. **Step 5: Commit** `feat: shared player with seek and single-media playback`.

### Task 5: Song screen layout + ⚙ drawer + track player ("Buradan başla")

**Files:** Create `src/ui/Drawer.tsx`; Modify `src/ui/SongDetail.tsx` (new layout: header with ‹, title, meta line "SANATÇI · DURUM · PARÇA: dosya", big tempo "BPM · N VURUŞ"; stage slot; recordings below; ⚙ opens drawer), `src/ui/TrackPanel.tsx` (custom "Parça seç" button over hidden file input; Player for the track with "Buradan başla" in `extra`; start `m:ss` input and volume stay), `src/ui/SongForm.tsx` (renders inside drawer for Düzenle); Tests: update `src/ui/SongDetail.test.tsx`, add drawer tests.

**Interfaces — Consumes:** Tasks 3–4. **Produces:** `<Drawer open onClose title>{children}</Drawer>` (right-side panel, `role="dialog"`, Esc closes, focus moves into it and back to ⚙ on close). SongDetail props unchanged plus `drawerSlot?: ReactNode` for the Recorder's device section (Task 6 fills it via portal target id `device-settings`). Drawer contents order: Durum segment (Çalıştığım/Bildiğim), Tempo, Sayım, Parça (TrackPanel), Cihazlar (portal target), Işık (A / C / Kapalı segment bound to lightPrefs), Düzenle, Sil. Recorder stays mounted when the drawer opens/closes and while editing.
"Buradan başla": saves `Math.round(currentTime*10)/10` as `track.startSec` via existing patch path; shows the new value in the `m:ss` field.
- [ ] **Step 1: Failing tests:** ⚙ opens drawer, Esc closes it, focus returns to ⚙; status/tempo/count edits still persist (existing tests moved into drawer); "Buradan başla" at currentTime 12.34 saves `startSec 12.3`; Düzenle opens the form inside the drawer and the recorder slot stays mounted (mount counter); light segment changes `getLightMode()`; file picker button text "Parça seç", no "Choose File".
- [ ] **Step 2–4:** RED, implement, GREEN. **Step 5: Commit** `feat: song screen layout, settings drawer, track player`.

### Task 6: Recorder restyle + auto ses preview + light wiring

**Files:** Modify `src/ui/Recorder.tsx` (stage: preview video or empty stage; big centered countdown inside stage (replace full-screen overlay or restyle `CountdownOverlay` to sit in stage, keeping `role="dialog" class="countdown"`); bottom row: Ses/Video segment, LevelMeter bar, round red record button (aria-label "Kaydet"/"Durdur"), hint; device selectors rendered via portal into `#device-settings` when present, inline fallback otherwise), `src/ui/DeviceSelectors.tsx`, `src/ui/LevelMeter.tsx` (bar styling), `src/ui/CountdownOverlay.tsx`, `src/App.tsx` (set `lightBus.setHueBpm(song.bpm)` + `setSource({kind:'free',bpm})` on song screen, `{kind:'breath'}` + `setHueBpm(null)` on list); Tests: update `src/ui/Recorder.test.tsx`.

**Interfaces — Consumes:** Tasks 1, 2, 4, 5. On take start: `pauseAll()`; pass `onBeatPlan` → `lightBus.setSource({kind:'take',ctx,plan})`; on take end/cancel/fail → back to `{kind:'free',bpm}`.
Default mode on mount: `'ses'` with preview acquired automatically; NotAllowedError shows "Mikrofona erişim izni verilmedi." and the screen stays usable (light keeps free pulse).
- [ ] **Step 1: Failing tests:** mounts in ses mode and calls getUserMedia once without a click; NotAllowed on auto-open shows the message, no crash, Kaydet disabled; starting a take calls `pauseAll` and sets bus source kind `'take'` when `onBeatPlan` fires; after `done` resolves source returns to `'free'`; record button has accessible name "Kaydet" then "Durdur"; all previous Recorder behaviour tests (Space rules, cancel, write failure, missing track, preparing) still pass with updated queries; device selectors render inside `#device-settings` when that element exists.
- [ ] **Step 2–4:** RED, implement, GREEN; `npm test`, `npm run build`.
- [ ] **Step 5:** Playwright screenshots (fake media flags + OPFS picker) of song screen idle, count-in, recording, drawer open, at 1280×800 and 400×800; check no horizontal scroll and text readable in mode C. **Commit** `feat: recorder restyle, auto preview, rhythm light wiring`.

### Task 7: Settings dialog + polish + README

**Files:** Modify `src/ui/SettingsDialog.tsx` (restyle; add Işık segment A / C / Kapalı bound to lightPrefs), `README.md` (Turkish: ışık seçenekleri, sarma, Buradan başla, ⚙ paneli); Test `src/ui/SettingsDialog.test.tsx` (light segment).
- [ ] **Step 1: Failing test:** choosing "C" in the dialog sets `getLightMode()==='c'`; latency behaviour tests unchanged.
- [ ] **Step 2–4:** RED, implement, GREEN; full suite + build.
- [ ] **Step 5: Commit** `feat: light mode in settings, readme`.
