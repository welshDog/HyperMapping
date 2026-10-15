# HyperMapping Sound Reaction and Speed Slider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A **Speed** slider (0.25x to 2x, no jump when moved) and microphone reaction for the random visuals: bass punch, treble sparkle, volume drives speed, and a big beat starts a new look, with live level bars, a sensitivity slider and clear permission messages.

**Architecture:** Speed is pure maths on three new `GeneratorState` fields. Sound is analysed ONLY in the Editor (microphone permission + Web Audio `AnalyserNode`), reduced to bass/treble/volume by pure, synthetic-sound-tested functions, masked by the tick boxes and sensitivity, and broadcast as a tiny `audio` channel message (~30/s); the Output window and simulator feed those numbers into their own shaders (`u_pulse`, new `u_treble`, new `u_atime`) and never touch the microphone.

**Tech Stack:** TypeScript 5.9 (strict), Vitest 2 (Node env), Web Audio API, WebGL2 / GLSL ES 3.00, React 18.

**Spec:** `docs/superpowers/specs/2026-10-15-sound-and-speed-design.md` (binding; this plan argues from it). Builds on `docs/superpowers/plans/2026-10-15-hypermapping-random-visuals.md` and `src/generator/`.

## Global Constraints

- Speed range 0.25..2 (default 1); shader time `shaderTime(state, now) = timeAnchor + max(0, now - speedChangedAt)/1000 * speed`; at defaults it equals today's `(now - startedAt)/1000`.
- Audio constants: analyser `fftSize` 2048, `smoothingTimeConstant` 0.4, read every ~33 ms; bands bass 20..150 Hz, mid 150..4000 Hz, treble 4000..12000 Hz (clamped to Nyquist), volume = mean of all bins 20..12000 Hz; `PEAK_DECAY` 0.995, `PEAK_FLOOR` 0.08, `NOISE_GATE` 0.04, envelope `ATTACK` 0.6 / `RELEASE` 0.12 per ~30 fps frame; sensitivity 0.2..3 (default 1); beat = smoothed bass > running mean (30 frames) x 1.5 AND > 0.3, gap >= 250 ms; `BEAT_LOOK_MIN_MS` 6000; `VOLUME_SPEEDUP` 1.5; stale levels fade linearly to 0 between 100 ms and 400 ms of silence on the channel.
- `audio` message: `{ type: 'audio', bass, treble, vol }`, each finite and clamped to 0..1 by the parser; sent only while listening, plus one all-zero message when listening stops. The Editor applies sensitivity and the tick boxes BEFORE sending (turned-off reaction = 0).
- Listening is never remembered across reloads; the tick boxes, sensitivity and speed are remembered per browser through guarded storage (try/catch; a bad stored value falls back to defaults, never crashes).
- With `u_pulse = u_treble = u_atime = 0` and speed 1 every look must render EXACTLY as it does at the start of this work (pixel-compared in Task 5).
- A single `bg-*` colour class per element state; inputs >= 16px text and `select-text` where they are text fields; no dev server started by implementers except the throwaway headless checks (use a free port and stop it, or the one already on :5173 which must NOT be killed); test count only goes up (baseline **440**); commit trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; **stage ONLY the files you changed, by name (never `git add -A` or `.`), never anything under `.superpowers/`**; working directory `h:\HYPERFOCUSZONE\HperCore\HyperMapping`.

## Review Focus

1. **No jump, no regression**: changing speed is continuous; defaults reproduce the old time; an old stored state (no speed fields) still loads.
2. **Pure audio maths is right on real shapes of sound**: tones land in the right band at both common sample rates; silence is silence; loud and quiet rooms both reach full scale; no beats from a steady drone; beats at the right rate for a pulse train.
3. **Hostile or stale channel data**: the `audio` parser rejects junk and clamps; windows fade stale levels so a closed Editor never freezes a pulse; `generator` parser still rebuilds clean copies including the new fields.
4. **Resource and permission hygiene**: mic tracks stopped on Stop/unmount; `AudioContext` closed; no leaked timers; denied/no-mic/unsupported produce messages and leave everything else working; `start()` only from a tap.
5. **The zero-reaction picture is unchanged and every reaction is visible**: pixel-exact at zero, clearly different at full (headless render).

---

## File Structure

```
src/generator/speed.ts            shaderTime, setSpeed, clampSpeed (+ test)
src/generator/shuffle.ts          GeneratorState + speed fields, initialState, isValidState (+ test updates)
src/ui/generator-actions.ts       setOn resets the time anchor; setSpeedAction (+ test updates)
src/generator/remember.ts         remember/load speed (+ test updates)
src/output/protocol.ts            generator message carries the new fields; new audio message (+ test)
src/audio/bands.ts                bandLevels (+ test)
src/audio/tracker.ts              createLevelTracker (+ test)
src/audio/beat.ts                 createBeatDetector (+ test)
src/audio/settings.ts             AudioSettings, parseAudioSettings, masked, load/save (+ test)
src/audio/motion.ts               fadeLevels, stepAudioTime (+ test)
src/audio/test-spectrum.ts        test support: synthetic spectra
src/audio/listener.ts             createAudioListener (DOM)
src/generator/shaders.ts          reactions + u_treble/u_atime
src/generator/source.ts           setAudio, speed time, new uniforms
src/ui/useAudioReactor.ts         Editor-side engine hook
src/ui/useOutputFeed.ts           audio message -> generator.setAudio
src/ui/GeneratorPanel.tsx, src/ui/Editor.tsx, README.md
```

---

### Task 1: Speed state (pure) — `GeneratorState`, `shaderTime`, `setSpeed`, validation, protocol, remembering

**Files:**
- Create: `src/generator/speed.ts`, `src/generator/speed.test.ts`
- Modify: `src/generator/shuffle.ts` (+ `shuffle.test.ts`), `src/ui/generator-actions.ts` (+ `generator-actions.test.ts`), `src/generator/remember.ts` (+ `remember.test.ts`), `src/output/protocol.ts` (+ `protocol.test.ts`)

**Interfaces (exact):**
```ts
// speed.ts
export const SPEED_MIN = 0.25; export const SPEED_MAX = 2;
export function clampSpeed(x: number): number;                       // NaN -> 1, clamped to [0.25, 2]
export function shaderTime(s: Pick<GeneratorState,'timeAnchor'|'speedChangedAt'|'speed'>, now: number): number;
export function setSpeed(state: GeneratorState, speed: number, now: number): GeneratorState; // continuous
// shuffle.ts: GeneratorState gains
//   speed: number; timeAnchor: number; speedChangedAt: number;
// initialState: speed 1, timeAnchor 0, speedChangedAt = now
// isValidState: speed finite and within [0.25,2]; timeAnchor finite and >= 0; speedChangedAt finite
```

- [ ] **Step 1: Write failing tests (all of these):**
  - `clampSpeed`: 1 -> 1, 0.1 -> 0.25, 9 -> 2, NaN -> 1, Infinity -> 2, -3 -> 0.25.
  - `shaderTime`: with defaults (`timeAnchor 0`, `speedChangedAt = startedAt`, `speed 1`) equals `(now - startedAt)/1000` for several `now`; `now < speedChangedAt` gives `timeAnchor`; speed 2 doubles the elapsed part.
  - `setSpeed` continuity: for speeds `[0.25, 0.5, 1, 1.7, 2]` and change times `[0, 1234, 60000]` from a state with some prior speed, `shaderTime(next, now) === shaderTime(prev, now)` (within 1e-9) at the change instant, and afterwards advances at the new speed; two successive changes stay continuous; clamps out-of-range input; returns a valid state (`isValidState`); same speed returns the same object.
  - `initialState` now carries the three fields; `isValidState` accepts it; rejects speed 0, speed 5, NaN speed, negative `timeAnchor`, NaN `speedChangedAt`, missing fields.
  - `generator-actions`: `setOn(state, true, now)` also sets `timeAnchor = 0` and `speedChangedAt = now` (and keeps `speed`); switching off leaves them; already-on returns the same object (existing tests stay green).
  - `remember`: saving stores `speed`; loading a stored object WITHOUT speed fields (old format) returns the stored look with `speed 1`; a stored `speed: 9` or `"fast"` falls back to 1 while the look/shuffle survive; loading sets `timeAnchor 0` and `speedChangedAt = now`.
  - `protocol`: a `generator` message with the new fields round-trips; extra fields are dropped; missing/invalid speed fields are rejected.
- [ ] **Step 2:** Run `npx vitest run src/generator src/ui src/output` — FAIL.
- [ ] **Step 3: Implement** to the interfaces. `setSpeed`: `const speed = clampSpeed(x); if (speed === state.speed) return state; return { ...state, timeAnchor: shaderTime(state, now), speedChangedAt: now, speed }`. Update `parseMsg` (`case 'generator'`) to rebuild the three new fields. Update `loadGeneratorState`/`saveGeneratorState` (store `speed`, fill defaults when absent/invalid). `setOn` (on) additionally `timeAnchor: 0, speedChangedAt: now`.
- [ ] **Step 4:** `npx tsc --noEmit`, full `npm test`, `npm run build` (Editor/useOutputFeed construct states via `initialState`, so they compile unchanged; fix any other literal `GeneratorState` constructions the compiler finds). Commit `feat(generator): speed state with continuous time anchor`.

---

### Task 2: Use the speed — shader time, `source.ts`, Speed slider

**Files:**
- Modify: `src/generator/source.ts`, `src/ui/GeneratorPanel.tsx`, `src/ui/generator-actions.ts` (+ test), `src/ui/Editor.tsx` (only if the panel wiring needs a prop), `README.md`

**Interfaces:**
- Consumes: `shaderTime`, `setSpeed` (Task 1).
- Produces: `source.ts` sets `u_time` from `shaderTime(state, now)`; panel prop `onChange` already exists, so the slider just calls `onChange(setSpeed(state, value, Date.now()))`.

- [ ] **Step 1:** In `source.ts` replace `Math.max(0, now - s.startedAt) / 1000` with `shaderTime(s, now)`. Nothing else in the draw path changes.
- [ ] **Step 2:** Panel: a **Speed** range input (`min 0.25 max 2 step 0.05`), label "Speed" with the value shown as `1.00x`, `aria-label="Speed"`, native range styling consistent with the panel; disabled when not `available`; updating it calls `onChange(setSpeed(state, value, Date.now()))`; it must not throw or cause a jump (continuity is guaranteed by `setSpeed`). Put it right under the Look picker.
- [ ] **Step 3:** README: one line in "Random visuals": speed slider 0.25x to 2x, moving it never jumps the picture.
- [ ] **Step 4:** tsc, tests (existing source tests stay green), build. DOM parts have no unit tests: say so; read-through: the only change to `source.ts` is the time expression. Commit `feat(ui): speed slider for the random visuals`.

---

### Task 3: The pure audio maths

**Files:**
- Create: `src/audio/bands.ts`, `tracker.ts`, `beat.ts`, `settings.ts`, `motion.ts`, `test-spectrum.ts` and a `.test.ts` for each of the first five.

**Interfaces (exact):**
```ts
// bands.ts
export interface Bands { bass: number; mid: number; treble: number; volume: number }  // each 0..1
export function bandLevels(freq: Uint8Array, sampleRate: number): Bands;
// tracker.ts
export const PEAK_DECAY = 0.995, PEAK_FLOOR = 0.08, NOISE_GATE = 0.04, ATTACK = 0.6, RELEASE = 0.12;
export interface LevelTracker { update(raw: Bands, sensitivity?: number): Bands; reset(): void }
export function createLevelTracker(): LevelTracker;
// beat.ts
export const BEAT_RATIO = 1.5, BEAT_MIN_LEVEL = 0.3, MIN_BEAT_GAP_MS = 250, BEAT_WINDOW = 30;
export interface BeatDetector { update(smoothedBass: number, nowMs: number): boolean; reset(): void }
export function createBeatDetector(): BeatDetector;
// settings.ts
export interface AudioSettings { sensitivity: number; bass: boolean; treble: boolean; volume: boolean; beatLook: boolean }
export const DEFAULT_AUDIO_SETTINGS: AudioSettings;                         // { 1, true, true, true, false }
export function parseAudioSettings(raw: unknown): AudioSettings;            // never throws; fills defaults; clamps sensitivity to [0.2, 3]
export function masked(levels: Bands, s: AudioSettings): { bass: number; treble: number; vol: number };
export const AUDIO_KEY = 'hypermapping.audio.v1';
export function loadAudioSettings(store: KeyValueStore | null): AudioSettings;   // guarded
export function saveAudioSettings(store: KeyValueStore | null, s: AudioSettings): void; // guarded, never throws
// motion.ts
export const STALE_START_MS = 100, STALE_END_MS = 400, VOLUME_SPEEDUP = 1.5;
export function fadeLevels(l: { bass: number; treble: number; vol: number }, ageMs: number): { bass: number; treble: number; vol: number };
export function stepAudioTime(prev: { smooth: number; atime: number }, vol: number, dtSec: number): { smooth: number; atime: number };
// test-spectrum.ts (test support only)
export function sineSpectrum(freqHz: number, sampleRate: number, bins: number, amplitude?: number): Uint8Array; // 0..255, peak at the bin for freqHz plus one neighbour each side at 60%, rest 0
```

- [ ] **Step 1: Write failing tests (all):**
  - `bands`: `sineSpectrum(60, rate, 1024)` -> bass > 0.5 and treble 0 at rates 44100 AND 48000; 8000 Hz -> treble > bass and bass 0; 1000 Hz -> mid dominant; silence (all zeros) -> every field 0; all-255 spectrum -> every field 1; a tiny spectrum (3 bins) does not throw and returns values within 0..1; band edges respect Nyquist (e.g. rate 16000 clamps treble to 8000 Hz without NaN); `volume` is the mean over 20..12000 Hz.
  - `tracker`: feeding a constant quiet signal (raw bass 0.1, volume 0.1) for 200 frames drives `bass` toward 1 (>= 0.9) while a constant loud signal (0.8) also reaches >= 0.9 (adaptive gain); below the noise gate (raw volume 0.02) every output is 0 and the peak does not climb (then a 0.1 signal still reads as strong after silence, proving the peak stayed low); rise is faster than fall (after a step up then a step down, the first-frame increase exceeds the first-frame decrease in magnitude); `sensitivity` 2 gives >= sensitivity 1 and never exceeds 1; sensitivity 0.2 reduces; outputs always within 0..1; `reset` clears state; NaN/negative inputs are treated as 0 (never produce NaN).
  - `beat`: a steady bass level 0.6 for 5 s gives no beats after the initial window warms up (assert zero beats after the first second); a 120 BPM pulse train (bass 0.9 for 3 frames every 500 ms, 0.15 between, at 33 ms steps over 10 s) gives between 17 and 21 beats; no two consecutive beats closer than 250 ms; a blip to 0.25 (< 0.3) never fires; `reset` clears.
  - `settings`: `parseAudioSettings` of `null`, `42`, `[]`, `{}`, `{sensitivity: 'x'}` gives defaults; `sensitivity` 99 -> 3, 0 -> 0.2, -1 -> 0.2, NaN -> 1; booleans only accepted as real booleans; extra keys dropped; load/save round trip; load with a throwing store, a null store, corrupt JSON returns defaults; save never throws; listening is not part of the settings. `masked`: a turned-off reaction is exactly 0 and the others are unchanged; `vol` comes from `volume`.
  - `motion`: `fadeLevels`: age 0..100 ms returns the levels unchanged; 250 ms halves them (linear 100->400: factor 0.5); >= 400 ms returns zeros; negative age unchanged; never negative. `stepAudioTime`: with `vol 0` and `smooth 0`, `atime` does not change; with `vol 1` for 1 s of 33 ms steps `atime` grows by about `VOLUME_SPEEDUP * ~1 s` (between 1.1 and 1.5 after the ease-in, assert the exact formula you implement: `smooth += (vol - smooth) * min(1, dtSec * 8)`; `atime += dtSec * VOLUME_SPEEDUP * smooth`); `atime` never decreases; `dtSec <= 0` or NaN changes nothing; huge `dtSec` (a throttled tab, e.g. 5 s) is clamped to 0.25 s so time does not leap.
- [ ] **Step 2:** `npx vitest run src/audio` — FAIL (modules missing).
- [ ] **Step 3: Implement** to the interfaces. `bandLevels`: `binHz = sampleRate / (2 * freq.length)`; band = bins with centre `i * binHz` in range (bin 0 excluded), mean of `freq[i]/255`; empty band -> 0; `volume` over 20..min(12000, Nyquist). `createLevelTracker`: per band keep `peak` and `smooth`; `norm = clamp01((raw / max(peak, PEAK_FLOOR)) * sensitivity)` where `peak = max(raw, peak * PEAK_DECAY)` updated only when raw volume >= `NOISE_GATE`; below the gate target 0 and peaks untouched; envelope `smooth += (target - smooth) * (target > smooth ? ATTACK : RELEASE)`. Returns `{bass, mid, treble, volume}` smoothed values. `createBeatDetector`: ring buffer of `BEAT_WINDOW` values, mean computed BEFORE inserting the new value; fire when `bass > mean * BEAT_RATIO && bass > BEAT_MIN_LEVEL && now - lastBeat >= MIN_BEAT_GAP_MS`; warm-up: no beat until the buffer is full.
- [ ] **Step 4:** tsc, full tests, build. Commit `feat(audio): band levels, adaptive level tracker, beat detector, settings and motion maths`. In the report include the measured beat count for the pulse train and the tracker's output after 200 frames for quiet and loud input.

---

### Task 4: The `audio` channel message and the microphone listener

**Files:**
- Modify: `src/output/protocol.ts`, `src/output/protocol.test.ts`
- Create: `src/audio/listener.ts`

**Interfaces:**
- Produces: `Msg` gains `{ type: 'audio'; bass: number; treble: number; vol: number }`; `parseMsg` accepts it only when all three are finite numbers and returns them clamped to 0..1 (a fresh object, extra fields dropped). `listener.ts`:
```ts
export type ListenResult = 'ok' | 'denied' | 'no-mic' | 'unsupported';
export interface AudioListener { start(): Promise<ListenResult>; stop(): void; onFrame(fn: (freq: Uint8Array, sampleRate: number) => void): void }
export function createAudioListener(): AudioListener | null;   // null when getUserMedia or AudioContext is missing
```

- [ ] **Step 1: Failing protocol tests:** accepts `{type:'audio', bass:0.5, treble:0.2, vol:1}`; clamps 1.7 -> 1 and -0.3 -> 0; rejects missing fields, NaN, Infinity, strings, null; drops extra fields.
- [ ] **Step 2:** Implement the parser case. Run the protocol tests: PASS.
- [ ] **Step 3: `createAudioListener`** (DOM; no unit test, say so): returns `null` unless `navigator.mediaDevices?.getUserMedia` and `window.AudioContext ?? window.webkitAudioContext` exist. `start()`: creates the context lazily INSIDE start (it is called from a tap), `await ctx.resume()`, `getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })`; maps `NotAllowedError`/`SecurityError` to `'denied'`, `NotFoundError`/`OverconstrainedError` to `'no-mic'`, anything else to `'unsupported'`; builds `MediaStreamSource -> AnalyserNode (fftSize 2048, smoothingTimeConstant 0.4)` (NOT connected to the destination, so nothing is played); a `setInterval` of 33 ms reads `getByteFrequencyData` into a reused `Uint8Array(analyser.frequencyBinCount)` and calls the frame callback with `ctx.sampleRate`; calling `start()` twice does not create a second graph. `stop()` clears the interval, stops all tracks, closes the context (in try/catch), is idempotent and safe before `start()`. A callback that throws must not kill the loop.
- [ ] **Step 4:** tsc, full tests, build. Commit `feat(audio): audio channel message and microphone listener`.

---

### Task 5: Shader reactions and the source's audio input

**Files:**
- Modify: `src/generator/shaders.ts`, `src/generator/source.ts`, `src/generator/shaders.test.ts`

**Interfaces:**
- Consumes: `fadeLevels`, `stepAudioTime` (Task 3).
- Produces: `GeneratorSource.setAudio(levels: { bass: number; treble: number; vol: number }): void`; new global uniforms `u_treble` (float) and `u_atime` (float), added to `GLOBAL_UNIFORMS`; `u_pulse` now carries the faded bass level.

**Shader requirements:** time in every look becomes `t = (u_time + u_atime) * speed` (find the current `float t = u_time * speed;`). Keep `float pulse = 1.0 + 0.15 * u_pulse;` as the common brightness/size breath, and add per-look reactions, all multiplicative on the existing maths so zero uniforms reproduce today's picture EXACTLY: **plasma**: bass scales the warp amplitude (e.g. `warp *= 1.0 + 0.8*u_pulse`) and brightness; treble adds fine-grain contrast (e.g. a higher-octave term weighted by `u_treble`). **kaleidoscope**: bass = breathing zoom of the polar coordinates and ring pulse; treble = bright glints on petals (a thresholded high-frequency noise added by `u_treble`). **neon**: bass expands ring radii/glow width; treble flickers grid line brightness and edge intensity. **particles**: bass enlarges and brightens dots; treble raises twinkle amplitude and cross-flare length. Every addition must be `x * (1.0 + k*u_*)` or `+ k*u_*` with `u_* = 0` giving the old value bit-for-bit.

**source.ts requirements:** keep `setAudio` input `{bass, treble, vol}` with a timestamp (`performance.now()`); per frame compute `age = now - lastAudioAt`, `l = fadeLevels(last, age)`, advance `{smooth, atime} = stepAudioTime(prev, l.vol, dtSeconds)` (dt from the frame timestamps, clamped by the helper), set `u_pulse = l.bass`, `u_treble = l.treble`, `u_atime = atime`; before any audio arrives all three are 0; the draw loop skips all of this while not drawing (no accumulation while off/inactive).

- [ ] **Step 1: Baseline renders BEFORE touching the shaders.** Using the same throwaway headless-Chrome method as the earlier generator check (scratchpad directory `C:\Users\Lyndz\AppData\Local\Temp\claude\H--HYPERFOCUSZONE-HperCore\f85f169e-7c05-48c1-b254-49261cae2292\scratchpad`; a throwaway `generator-check.html` + `src/generator/check-main.ts` that you delete before committing; the dev server on https://localhost:5173 is the user's: do NOT kill it; clock FROZEN so renders are deterministic), render one frame per look (plasma, kaleidoscope, neon, particles; fixed seed; fixed time 7.3 s; `u_pulse = u_treble = u_atime = 0`) and save the PNGs as the baseline.
- [ ] **Step 2: Failing tests** in `shaders.test.ts`: `GLOBAL_UNIFORMS` contains `u_treble` and `u_atime`; the fragment source declares them and references `u_atime` in the time expression and `u_treble` in at least four places (one per look); `source.ts`'s uniform name list matches.
- [ ] **Step 3:** Implement the shader changes and `setAudio`/uniform plumbing.
- [ ] **Step 4: Pixel-compare**: re-render the same four frames at zero reaction uniforms and compare to the baseline PNGs pixel by pixel (numpy/PIL); they MUST be identical (report the max channel difference per look; if non-zero, fix the shader until it is zero). Then render each look at `u_pulse = 1, u_treble = 1` and at `u_atime = 5`; READ the screenshots and describe in one line per look what visibly changed with bass, with treble, and with atime; every look must change visibly for bass and for treble. Do not tune endlessly (3 rounds), report honestly.
- [ ] **Step 5:** delete the throwaway files; `git status` shows only your three files; tsc, tests, build. Commit `feat(generator): bass, treble and loudness reactions in the shaders`.

---

### Task 6: Wire it up — Editor engine, Output feed, Sound panel, README

**Files:**
- Create: `src/ui/useAudioReactor.ts`
- Modify: `src/ui/Editor.tsx`, `src/ui/useOutputFeed.ts`, `src/ui/GeneratorPanel.tsx`, `README.md`

**Interfaces:**
- Consumes: everything above.
- `useAudioReactor` (Editor-side hook; keep Editor.tsx from bloating) returns `{ status: 'off' | 'listening' | 'denied' | 'no-mic' | 'unsupported'; levels: { bass: number; treble: number; volume: number }; settings: AudioSettings; setSettings(next: AudioSettings): void; start(): Promise<void>; stop(): void }` and takes `{ channelRef, genStateRef, updateGenerator }` (refs, never stale state). `levels` for the meters is published to React at most 10 times per second.

- [ ] **Step 1: `useAudioReactor`:** create the listener lazily on first `start()` (a user tap); on each frame run `bandLevels` -> tracker (with `settings.sensitivity` read from a ref) -> `masked` -> `channelRef.current?.postMessage({ type: 'audio', ...masked })` (every frame, ~30/s), feed the smoothed bass to the beat detector; when `beatLook` is on, the generator `on`, listening, a beat fires and `now - genStateRef.current.changedAt >= BEAT_LOOK_MIN_MS` call `updateGenerator(randomizeState(genStateRef.current, now, Math.random))`. `stop()` (and unmount) stops the listener, resets tracker/detector, posts one `{ type: 'audio', bass: 0, treble: 0, vol: 0 }`, sets status `off`. Settings load from storage at creation (guarded) and save on change. `start()` results `denied` / `no-mic` / `unsupported` set the matching status and leave everything else working; a second `start()` while listening does nothing. No timers or tracks leak on unmount.
- [ ] **Step 2: `useOutputFeed`:** handle `audio` messages: `generatorRef.current?.setAudio({ bass, treble, vol })` (store nothing else); everything else unchanged (all existing guards, cleanup order).
- [ ] **Step 3: Panel** — a **Sound** section below the existing controls (exact spec text): **Listen** / **Stop** button (one `bg-*` class per state) and a status line ("Off", "Listening", "Microphone blocked: allow it in the browser's site settings", "No microphone found", "Not supported in this browser"); three live level bars (bass, treble, volume; `div`s with inline width %, `role="meter"` with `aria-valuenow`); **Sensitivity** range 0.2..3 step 0.1 with the value shown; four tick boxes: **Bass punch**, **Treble sparkle**, **Volume speeds motion**, **Big beat starts a new look** (labelled `<label><input type=checkbox/>…`); all disabled with a note when listening is unsupported. The panel receives the reactor's `status`, `levels`, `settings`, `setSettings`, `start`, `stop` as props from the Editor.
- [ ] **Step 4: Editor:** call `useAudioReactor`, pass its values into `GeneratorPanel`; nothing else about source selection changes.
- [ ] **Step 5: README:** a "Sound reaction" subsection: press Listen (allow the microphone), the four reactions, Sensitivity, the beat option, "keep the Editor window visible (browsers slow hidden tabs)", the microphone stays in the browser and only three numbers go to the other windows, windows are close but not pixel-identical while music drives speed.
- [ ] **Step 6:** tsc, full tests, build. No unit tests for React/DOM parts: say so and give the read-through checklist confirmed against the code: only taps call `start()`; stop/unmount release everything; the channel/state accessed through refs; beat randomize respects `BEAT_LOOK_MIN_MS`; levels meters throttled; one `bg-*` class per element state; `audio` messages stop when listening stops. Commit `feat(ui): Sound section, microphone engine and audio feed for the visuals`.

---

## Self-Review

**Spec coverage:** speed slider and no-jump maths (Tasks 1-2); bands, tracker, beat, settings, masking, stale fade, volume-to-time (Task 3); `audio` message and microphone listener (Task 4); four reactions + zero-regression pixel check (Task 5); Listen/Stop, meters, sensitivity, tick boxes, beat-starts-new-look, README (Task 6); storage of settings and speed (Tasks 1, 3, 6). Spec edge cases 1-9: 1-5 and 8 in Task 3, 6 in Task 1, 7 in Task 4, 9 in Task 5.

**Placeholder scan:** none. Task 5's shader reactions are specified by behaviour and verified by pixel-exact zero-reaction comparison plus screenshots.

**Type consistency:** `GeneratorState` new fields `speed`, `timeAnchor`, `speedChangedAt`; `Bands` (`bass, mid, treble, volume`) vs the message/masked shape (`bass, treble, vol`); `AudioSettings` field names (`sensitivity, bass, treble, volume, beatLook`); `setAudio({ bass, treble, vol })`; `fadeLevels`/`stepAudioTime` signatures are spelled identically wherever used.

**Known risks to watch at execution time:** parallel implementers sweeping each other's files (stage by name only); the analyser's dB-scaled bytes make absolute thresholds device-dependent (the adaptive peak and noise gate are the mitigation; the real-music check is Lyndz's); hidden-tab timer throttling; zero-uniform exactness depends on every shader edit being `x*(1+k*u)` or `+k*u`.
