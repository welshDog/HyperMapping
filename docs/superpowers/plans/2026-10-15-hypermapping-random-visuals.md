# HyperMapping Random Visuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A **Visuals** button that puts an endless, good-looking, randomly generated picture on every face with no video file: four looks (plasma, kaleidoscope, neon geometry, particles), a **Randomize** button, optional auto-shuffle with a smooth cross-fade, and a short code that brings any look back.

**Architecture:** One full-screen WebGL2 fragment shader draws onto a hidden 960×540 canvas at 30 fps; that canvas becomes a live `<video>` through `captureStream` (the trick the test pattern already proved) and goes to `Renderer.setVideo`, so there are NO renderer or warp changes. The Editor owns a tiny deterministic *look state* and broadcasts it on the existing BroadcastChannel; the Output window and the simulator each render their own generator from the same state, so every window shows the same picture without streaming video.

**Tech Stack:** TypeScript 5.9 (strict), Vitest 2 (Node env), WebGL2 / GLSL ES 3.00, Canvas `captureStream`, React 18.

**Spec:** the approved plan `C:\Users\Lyndz\.claude\plans\h-hyperfocuszone-hpercore-hypermapping-h-async-pearl.md` (decisions: all four looks; Randomize + auto-shuffle with cross-fade and a code; no audio yet but shaders take `u_pulse`). Executors read it together with this document.

## Global Constraints

- Canvas 960×540, `captureStream(30)`, ~30 fps draw loop; cross-fade `FADE_MS = 1500` (smoothstep); auto-shuffle choices 0 (off), 15, 30, 60 seconds; speed range 0.5 to 1.4.
- `LOOK_STYLES = ['plasma', 'kaleidoscope', 'neon', 'particles']`. A look is ONLY `{ style, seed }` (seed = unsigned 32-bit integer); palette and speed are derived from the seed by pure functions, so the code reproduces the look exactly.
- Code format: `<letter>-<8 hex digits><1 check digit>`, uppercase, e.g. `K-7F3A92C1D` (letters P plasma, K kaleidoscope, N neon, S particles; check digit = sum of the 8 hex nibbles mod 16 as one hex digit). Parsing is lenient about case, spaces and a missing dash, strict about the letter, length and check digit.
- Source priority, in ONE pure function: test pattern forced > generator on > video loaded > test pattern fallback.
- Hidden video styling as in `sources/pattern.ts` (`position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px`, muted, `playsinline`, NEVER `display:none`). A source creator returns `null` and never throws when the browser cannot do it; then the button is disabled and behaviour is as before.
- Generator state is NOT saved in setups (like the pattern button). The last look and shuffle choice are remembered per browser through `getBrowserStore()` inside try/catch; the generator starts Off after a reload.
- A single `bg-*` colour class per element state; inputs ≥16px text with `select-text`; no dev server started by implementers (verify with tsc, vitest, build, plus the headless-Chrome check in Task 4); test count only goes up (baseline **360**); commit trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; never `git add` anything under `.superpowers/`; working directory `h:\HYPERFOCUSZONE\HperCore\HyperMapping`.

## Review Focus

1. **Determinism**: the same `(look, time, startedAt)` must give the same picture in every window (no `Math.random()` or `Date.now()` inside shaders; time and seeds come in as uniforms).
2. **Codes round-trip and reject garbage**: every look encodes and parses back identically; a wrong check digit, wrong letter, wrong length or non-hex is rejected, never guessed.
3. **Hostile or stale `generator` messages** from the channel: wrong types, NaN, out-of-range numbers, unknown styles are rejected by the parser.
4. **Resource hygiene**: the rAF loop, WebGL context, tracks and hidden video are released on dispose, unmount and when the renderer is recreated; two sources never run the loop twice.
5. **Source priority never shows a black screen it could avoid**: generator unavailable falls back to video or pattern; turning the generator off returns exactly the previous source.

---

## File Structure

```
src/sources/stream-video.ts     canvas -> hidden live video helper (+ test of the pure bits)
src/sources/pattern.ts          uses stream-video (behaviour unchanged)
src/generator/random.ts         mulberry32, hash helpers (+ test)
src/generator/look.ts           Look, derived palette/speed, randomLook, codes (+ test)
src/generator/shuffle.ts        GeneratorState, fade, currentLook, randomize, shuffleDue (+ test)
src/generator/select.ts         pickSource (+ test)
src/generator/shaders.ts        GLSL
src/generator/source.ts         createGeneratorSource (DOM)
src/output/protocol.ts          + 'generator' message (+ test)
src/ui/GeneratorPanel.tsx       Visuals panel
src/ui/Editor.tsx, src/ui/useOutputFeed.ts, src/ui/slice-aspect.ts, README.md
```

---

### Task 1: Extract the shared stream-to-video helper

**Files:**
- Create: `src/sources/stream-video.ts`
- Modify: `src/sources/pattern.ts` (use it; no behaviour change)
- Test: existing `src/sources/pattern.test.ts` must stay green; add `src/sources/stream-video.test.ts`.

**Interfaces:**
- Produces: `HIDDEN_VIDEO_STYLE: string` (the exact hidden style above), `interface StreamVideo { video: HTMLVideoElement; stream: MediaStream; ensurePlaying(): void; dispose(): void }`, `createStreamVideo(canvas: HTMLCanvasElement, fps: number): StreamVideo | null`.

- [ ] **Step 1:** Write `stream-video.test.ts` (Node env, no DOM): test `createStreamVideo` with a fake `canvas` whose `captureStream` is missing (returns `null`, does not throw) and one whose `captureStream` throws (returns `null`); and that `HIDDEN_VIDEO_STYLE` contains `opacity:0` and does not contain `display:none`. Run it: it fails (module missing).
- [ ] **Step 2:** Implement `createStreamVideo`: returns `null` if `typeof canvas.captureStream !== 'function'`; calls `canvas.captureStream(fps)`; creates a `<video>` (muted, `playsInline`, `setAttribute('playsinline','')`, style `HIDDEN_VIDEO_STYLE`, `srcObject = stream`), appends to `document.body`, `ensurePlaying()` = `if (el.paused) el.play()?.catch(() => {})` and calls it once; `dispose()` stops all tracks, pauses, clears `srcObject`, removes the element, safe to call twice; on any exception while building, release whatever was created and return `null`. (Mirror the exact cleanup idiom already in `createPatternSource`.)
- [ ] **Step 3:** Refactor `createPatternSource` to use `createStreamVideo(canvas, 10)` for the stream/video/ensurePlaying/dispose parts, keeping its own canvas, 2D context, redraw timer and its `release` ordering (timer cleared first). Its public behaviour and `PatternSource` shape do not change.
- [ ] **Step 4:** Run `npx tsc --noEmit`, `npm test` (all existing pattern tests green), `npm run build`. Commit `refactor(sources): shared stream-to-video helper`.

---

### Task 2: The pure generator modules

**Files:**
- Create: `src/generator/random.ts`, `src/generator/look.ts`, `src/generator/shuffle.ts`, `src/generator/select.ts` and a `.test.ts` for each.

**Interfaces (exact):**
```ts
// random.ts
export function mulberry32(seed: number): () => number;          // [0,1), deterministic
export function randomSeed32(rng: () => number): number;          // unsigned 32-bit integer
// look.ts
export const LOOK_STYLES: readonly ['plasma','kaleidoscope','neon','particles'];
export type LookStyle = (typeof LOOK_STYLES)[number];
export type StylePick = 'auto' | LookStyle;
export interface Look { style: LookStyle; seed: number }          // seed: integer 0..2^32-1
export interface Palette { a: [number,number,number]; b: [number,number,number]; c: [number,number,number]; d: [number,number,number] }
export function paletteFor(seed: number): Palette;                // IQ cosine palette params, deterministic, each component in [0,1.5]
export function speedFor(seed: number): number;                   // deterministic, in [0.5, 1.4]
export function randomLook(rng: () => number, pick: StylePick): Look;
export function isValidLook(x: unknown): x is Look;
export function lookToCode(look: Look): string;                   // 'K-7F3A92C1D'
export function lookFromCode(text: string): Look | null;
// shuffle.ts
export const FADE_MS = 1500;
export const SHUFFLE_CHOICES: readonly [0,15,30,60];
export interface GeneratorState { on: boolean; look: Look; prev: Look | null; changedAt: number; shuffleSec: 0|15|30|60; startedAt: number; stylePick: StylePick }
export function fadeAmount(now: number, changedAt: number, ms?: number): number;   // 0..1 smoothstep
export function currentLook(state: GeneratorState, now: number): { prev: Look | null; cur: Look; fade: number };
export function randomizeState(state: GeneratorState, now: number, rng: () => number): GeneratorState; // prev = old look, new look from randomLook(rng, state.stylePick), changedAt = now
export function shuffleDue(state: GeneratorState, now: number): boolean;
export function initialState(now: number, rng: () => number): GeneratorState; // off, random look, prev null, shuffleSec 0, stylePick 'auto'
export function isValidState(x: unknown): x is GeneratorState;
// select.ts
export type SourceKind = 'pattern' | 'generator' | 'video' | 'none';
export function pickSource(i: { patternForce: boolean; generatorOn: boolean; hasVideo: boolean; patternAvailable: boolean; generatorAvailable: boolean }): SourceKind;
```

- [ ] **Step 1: Write failing tests** (TDD; every bullet is a test):
  - `random`: same seed gives same sequence; values in [0,1); different seeds differ; `randomSeed32` is an integer in [0, 2^32).
  - `look`: `paletteFor`/`speedFor` deterministic and in range for 2000 seeds incl. 0 and 2^32−1; `randomLook(rng,'auto')` over 400 draws produces all four styles; `randomLook(rng, 'neon')` always neon; `isValidLook` rejects non-objects, unknown style, non-integer / negative / ≥2^32 seed; code round-trip for 1000 random looks AND for edge seeds 0 and 4294967295; `lookFromCode` accepts lowercase, spaces around, a missing dash; rejects wrong check digit, unknown letter, too short/long, non-hex, empty, non-string input; changing any single hex digit of a valid code is rejected (check digit catches it) — test all 8 positions × 15 alternatives.
  - `shuffle`: `fadeAmount` is 0 at start, 1 at/after `FADE_MS`, monotonic, smoothstep midpoint 0.5, clamped for `now < changedAt`; `currentLook` returns fade 1 and `prev` null when `state.prev` is null or the fade is finished, and `prev` set with 0<fade<1 mid-fade; `randomizeState` keeps `on`, `shuffleSec`, `stylePick`, `startedAt`, moves `look` to `prev`, sets `changedAt = now`, honours `stylePick`, is deterministic for a seeded rng, never returns the same look as before; `shuffleDue`: false when off or `shuffleSec` 0, false before the interval, true at/after it; `isValidState` accepts `initialState` output and rejects each field broken in turn (NaN times, bad shuffleSec like 20, bad pick, bad look, `prev` of wrong type).
  - `select`: the full truth table (2^5 = 32 rows) generated in the test from the written rule: pattern forced and available -> 'pattern'; else generator on and available -> 'generator'; else video loaded -> 'video'; else pattern available -> 'pattern'; else 'none'. A forced-but-unavailable pattern falls through to the next rule; a generator on but unavailable falls through.
- [ ] **Step 2:** Run `npx vitest run src/generator` — FAIL (modules missing).
- [ ] **Step 3:** Implement the four modules to the signatures above. Derivations: `paletteFor`/`speedFor` use `mulberry32(seed ^ 0x9E3779B9)` draws (documented constants), `a` components in [0.35,0.65], `b` in [0.30,0.55], `c` in [0.6,1.6] but clamped so every palette component stays within [0,1.5], `d` in [0,1]; `speedFor` = 0.5 + 0.9·draw. `lookToCode`: letter map P/K/N/S, seed as 8 uppercase hex digits zero-padded, check digit as specified. `fadeAmount` smoothstep `t*t*(3-2t)`.
- [ ] **Step 4:** `npx vitest run src/generator && npx tsc --noEmit && npm test && npm run build`. Commit `feat(generator): seeded looks, codes, shuffle and source selection`.

---

### Task 3: The `generator` channel message

**Files:**
- Modify: `src/output/protocol.ts`, `src/output/protocol.test.ts`

**Interfaces:**
- Consumes: `GeneratorState`, `isValidState` (Task 2).
- Produces: `Msg` gains `{ type: 'generator'; state: GeneratorState }`; `parseMsg` returns it only when `isValidState(d.state)` and rebuilds a clean copy (extra fields dropped).

- [ ] **Step 1: Failing tests:** accepts a valid `initialState`-shaped message and returns an equal object; drops extra top-level and nested fields; rejects missing `state`, a non-object `state`, NaN times, `shuffleSec: 20`, unknown style, seed −1 / 1.5 / 2^32, `on` not a boolean, `prev` of a wrong type; accepts `prev: null` and a valid `prev`.
- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement in `parseMsg` (`case 'generator'`), importing `isValidState` from `../generator/shuffle`; build the returned state field by field. **Step 4:** tsc, full tests, build (existing consumers narrow on `msg.type`, so they must still compile). Commit `feat(output): generator channel message`.

---

### Task 4: The shaders and the generator source (with a headless render check)

**Files:**
- Create: `src/generator/shaders.ts`, `src/generator/source.ts`

**Interfaces:**
- Consumes: `createStreamVideo`, `HIDDEN_VIDEO_STYLE` (Task 1); `GeneratorState`, `currentLook`, `paletteFor`, `speedFor`, `LOOK_STYLES` (Task 2).
- Produces: `VERTEX_SRC`, `FRAGMENT_SRC` (strings); `interface GeneratorSource { video: HTMLVideoElement; setState(state: GeneratorState): void; ensurePlaying(): void; dispose(): void }`; `createGeneratorSource(): GeneratorSource | null`; also export `renderLookToCanvas`-style test hook ONLY if needed by the check (see Step 3) — keep the public surface minimal.

**Shader requirements (GLSL ES 3.00, one fragment shader):**
- Uniforms: `u_res` (vec2), `u_time` (float seconds since `startedAt`), `u_fade` (float), `u_pulse` (float, always 0 for now: used by every look to gently scale brightness/size, `1.0 + 0.0*u_pulse` must still compile and be referenced), and for the current look and the previous look: style (int), seed (float), speed (float), palette `a,b,c,d` (vec3 each). When `u_fade >= 1.0` only the current look is evaluated.
- Shared: hash (no `sin` precision traps: use an integer-style or `fract`-based hash), value/gradient noise, fbm (4–5 octaves), IQ cosine palette `a + b*cos(6.28318*(c*t+d))`, soft vignette, gentle tone map.
- `plasma`: domain-warped fbm, two warp passes, palette indexed by the field + slow time.
- `kaleidoscope`: segment count 5..12 from the seed, polar fold, slow rotation, fbm + rings inside the fold, palette.
- `neon`: scrolling tunnel of polygon/circle rings (sides 3..8 from the seed) with additive glow, plus a perspective grid floor; dark background so the glow reads.
- `particles`: 3 parallax layers of hashed grid cells, each cell a drifting twinkling soft dot (seed picks fireflies / stars / rain-streak mode), dark gradient background.
- Everything deterministic in `(uniforms)`: no `Math.random`, no wall-clock reads.

**`createGeneratorSource` requirements:**
- Creates a 960×540 canvas with `getContext('webgl2', { preserveDrawingBuffer: true, antialias: false })`; returns `null` (never throws) if there is no WebGL2, the shaders fail to compile/link (log the info log with `console.warn`), or `createStreamVideo(canvas, 30)` returns null. Release everything created if any step fails.
- One rAF loop (fallback `setTimeout(…, 33)` when `document.hidden`); each frame computes `now = Date.now()`, `{prev, cur, fade} = currentLook(state, now)`, sets uniforms from `paletteFor/speedFor`, draws a full-screen triangle. Skips drawing while `state.on` is false (keeps the last frame, no GPU work).
- `setState` stores the state (no GL work); `ensurePlaying` delegates; `dispose` cancels the loop, deletes GL objects, loses the context (`WEBGL_lose_context`), disposes the stream video; safe to call twice; never runs two loops.

- [ ] **Step 1:** Write the shaders and `source.ts` to the requirements above.
- [ ] **Step 2:** `npx tsc --noEmit`, `npm test`, `npm run build` all pass.
- [ ] **Step 3: Headless render check** (no dev server needed beyond the one already running on :5173; if it is not running, start `npx vite --port 4401 --strictPort` in the background and stop it afterwards, verifying the port is free). Create a THROWAWAY page `generator-check.html` plus `src/generator/check-main.ts` (delete both before committing; never commit them) that, for each of the four styles at two seeds, builds a `GeneratorState` (`on: true`) and renders it with `createGeneratorSource()` at fixed times, reading the pixels back with `gl.readPixels` (or `canvas.toDataURL`) into a 4×2 contact sheet drawn on a visible 2D canvas, plus one cross-fade frame (`prev` style ≠ `cur` style, fade 0.5). Run headless Chrome (`C:\Program Files\Google\Chrome\Application\chrome.exe --headless=new --enable-unsafe-swiftshader --use-angle=swiftshader --ignore-certificate-errors --window-size=1920,1080 --virtual-time-budget=8000 --screenshot=<scratchpad>\generator-sheet.png https://localhost:<port>/generator-check.html`). Read the PNG with the Read tool and report, in plain words, what each cell looks like (is it non-black? varied between seeds? do the four styles look different? does the cross-fade cell mix two looks?). If the shader fails to compile, the page must print the info log into the DOM so it can be read with `--dump-dom`. Fix the shaders until all eight cells draw something non-black and distinct; do not tune endlessly: if a style looks poor, report it honestly with the screenshot path.
- [ ] **Step 4:** Delete the throwaway files; `git status` must show only `shaders.ts` and `source.ts`. Run tsc, tests, build. Commit `feat(generator): WebGL2 shaders and live-video source`. Report: the screenshot path, your description of the eight cells, and the compile result.

---

### Task 5: Wire the generator into the app

**Files:**
- Modify: `src/ui/Editor.tsx`, `src/ui/useOutputFeed.ts`, `src/ui/slice-aspect.ts`, `src/ui/slice-aspect.test.ts`

**Interfaces:**
- Consumes: `createGeneratorSource`/`GeneratorSource` (Task 4), `GeneratorState`/`initialState`/`randomizeState`/`shuffleDue` (Task 2), `pickSource` (Task 2), the `generator` message (Task 3).
- Produces: Editor state `genState: GeneratorState` (+ ref `genStateRef`), `genAvailable: boolean`, a function `updateGenerator(next: GeneratorState)` that: stores it, posts `{ type: 'generator', state: next }`, calls `genSourceRef.current?.setState(next)` and `applySource()`; Editor props to a later panel are wired in Task 6.

- [ ] **Step 1: `slice-aspect`**: change `SliceAspectInput` so callers pass `showing: 'pattern' | 'generator' | 'video' | 'none'` is NOT required — keep the existing signature and add an optional `generatorOn?: boolean` + `generatorAvailable?: boolean`; use `pickSource` so a shown generator gives 16:9. Add tests: generator on and available over a portrait video -> 16:9; generator on but unavailable -> the video's shape; pattern forced beats generator.
- [ ] **Step 2: `useOutputFeed`** (Output window and simulator): create a generator source next to the pattern source when the renderer exists; keep `generatorState` (default off); on a `generator` message store it, call `source.setState`, and re-run `apply()`; `apply()` now uses `pickSource({ patternForce: force, generatorOn: state.on, hasVideo, patternAvailable: pattern !== null, generatorAvailable: generator !== null })` and sets the renderer's video to the matching source (or `null`); dispose the generator source in the existing cleanup (before `renderer.setVideo(null)`); `resumeVideo` also nudges `ensurePlaying`. Preserve every existing guard (late-load token, stale-load disposal, previous handle disposed only after the renderer holds the new source, hello after onmessage).
- [ ] **Step 3: `Editor.tsx`**: create the generator source in an effect next to the pattern source (null -> `genAvailable=false`, force `on=false` and broadcast); `applySource` uses `pickSource` with the same inputs; add `genState` initialised from `initialState(Date.now(), Math.random)` (or the remembered look from browser storage, `on` always false at startup); channel effect: add `ch.postMessage({ type: 'generator', state: genStateRef.current })` to the hello reply and to the creation broadcast (exactly where `pattern` is posted); an effect with a 1 s interval that, while `on && shuffleSec > 0`, calls `updateGenerator(randomizeState(...))` when `shuffleDue`; remember `{look.style, look.seed, shuffleSec, stylePick}` to storage on change (guarded; `on` never remembered).
- [ ] **Step 4:** `npx tsc --noEmit`, `npm test`, `npm run build`. No unit tests for the React/DOM parts: say so. Report the read-through: every place that decides the renderer's source now goes through `pickSource`; cleanup order; hello/creation broadcasts; nothing starts a second rAF loop; turning the generator off restores the previous source. Commit `feat(ui): generator source selection in the Editor and Output windows`.

---

### Task 6: The Visuals panel, toolbar button and README

**Files:**
- Create: `src/ui/GeneratorPanel.tsx`
- Modify: `src/ui/Editor.tsx`, `README.md`

**Interfaces:**
- Consumes: Editor `genState`, `updateGenerator`, `genAvailable` (Task 5); `LOOK_STYLES`, `randomLook`, `lookToCode`, `lookFromCode`, `randomizeState`, `SHUFFLE_CHOICES` (Task 2).
- Produces: `GeneratorPanel` props `{ state: GeneratorState; available: boolean; onChange: (next: GeneratorState) => void; onClose: () => void }`.

- [ ] **Step 1:** Build the modal (same look as `SetupsPanel`: fixed overlay, `bg-zinc-900` card, `select-text`, inputs `text-base`): an **On / Off** switch (single `bg-*` class per state); **Look** picker: Auto, Plasma, Kaleidoscope, Neon, Particles (sets `stylePick`; also shows which look is current); **Randomize** (calls `onChange(randomizeState(state, Date.now(), Math.random))` and turns `on` true); **Auto-shuffle** buttons Off / 15 s / 30 s / 60 s (`aria-pressed`, one `bg-*` class per state); the current **code** in a read-only selectable box with a **Copy** button (clipboard API in try/catch, falls back to selecting the text) and a **Use code** input that accepts a code, validates with `lookFromCode`, shows a clear message on a bad code, and on success sets that look (as `randomizeState`-style cross-fade: `prev = old look`, `changedAt = now`, `on = true`). When `available` is false show "Visuals are not supported in this browser" and disable the controls. Never put user text into HTML except as React text.
- [ ] **Step 2:** Editor: **Visuals** toolbar button after **Test pattern** (`aria-pressed={genState.on}`, `disabled={!genAvailable}` with a title when unsupported, ONE `bg-*` class per state, `min-w` so the label does not jump) opening the panel; render the panel in edit mode only.
- [ ] **Step 3:** README: a "Random visuals" section (what the button does, Randomize, auto-shuffle, codes, priority with the test pattern and a loaded video, no audio yet, the minimised Output window pauses).
- [ ] **Step 4:** tsc, tests, build; read-through checklist: codes never throw on odd input; Copy never throws; the panel closes without side effects; no element has two `bg-*` classes. Commit `feat(ui): Visuals panel with Randomize, auto-shuffle and look codes`.

---

## Self-Review

**Spec coverage:** four looks (Task 4); Randomize + auto-shuffle + cross-fade (Tasks 2, 5, 6); codes (Task 2, 6); channel sync so all windows match (Tasks 3, 5); no renderer changes (none touched); `u_pulse` for later audio (Task 4); priority function (Tasks 2, 5); slice aspect (Task 5); button greys out when unsupported (Tasks 4–6); README (Task 6); shared stream helper (Task 1).

**Placeholder scan:** none; Task 4's shader content is specified by behaviour because GLSL is verified by rendering, not by a pre-written listing.

**Type consistency:** `Look {style, seed}`, `GeneratorState` fields, `StylePick`, `pickSource` inputs, `createGeneratorSource`/`GeneratorSource.setState`, and the `generator` message `{type, state}` are spelled identically wherever used.

**Known risks to watch at execution time:** WebGL `captureStream` on iOS Safari; shader aesthetics (subjective; tuning pass after the first on-screen test); a hidden Output window pausing rAF.
