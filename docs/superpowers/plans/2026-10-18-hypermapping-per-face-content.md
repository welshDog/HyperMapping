# Per-Face Content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each face picks its own source (Video, Test pattern, or its own / a shared Visual look); up to 4 distinct live looks, one microphone for all, mirrored in the Output window and simulator.

**Architecture:** Face data gains `source`, `look` (owner faces) and `lookOf` (sharer faces). Pure modules decide everything (normalising/repairing face lists, resolving what each face shows, reconciling per-look runtime state). A pool owns one existing `GeneratorSource` per live look. The renderer is told a video per face (`setFaceVideos`) and uploads each distinct video once per frame. The Editor, the Output window and the simulator all drive the same pool + resolver, so they cannot disagree.

**Tech Stack:** React + Tailwind + Vite + TypeScript, WebGL2/WebGPU, vitest (`npx vitest run`, `npx tsc --noEmit`).

**Spec:** `docs/superpowers/specs/2026-10-18-per-face-content-design.md`

## Global Constraints

- Every face has one source: `'video' | 'pattern' | 'look'`; missing means `'video'`. Only one shared video exists. New faces and every old saved setup start on Video.
- At most **4 distinct live looks** (`MAX_LOOKS = 4`); faces sharing a look count once. Enforced by ONE shared normalising function wherever a face list comes in (strict parser, Setups load/import, autosave restore, channel messages).
- Over the cap: keep the first 4 look owners in face order, demote the extra owners to Video; sharers of a demoted owner are repaired to an own look with `DEFAULT_LOOK_SETTINGS`. A sharing link to a missing face, to itself, or to a face that does not own a look is repaired to an own look (never rejected). An unknown `source` value rejects the whole list.
- Sharing links use the face `id` (`s1`, `s2`...; ids are already unique and validated), never the list position.
- The toolbar **Test pattern** button stays a wall-wide override (forces the pattern on every face; not saved).
- Sound: ONE microphone; Listen/Stop, Sensitivity and reaction ticks stay global; every live look gets the same levels. Zero reaction must render pixel-identical to before.
- Deleting or changing a face's source never alters another face's picture. Deleting an owner that others share: the first sharer becomes the owner with the same look settings, other sharers re-point to it.
- A restored look restarts cleanly (no previous look, no mid-fade, fresh clocks). Each look has its own state and time anchor.
- Look runtime state is `GeneratorState` (`src/generator/shuffle.ts`); persisted look settings are `LookSettings` (below). `on` is not persisted.
- Performance target: steady 30 fps with 4 live looks on the laptop. The builder may lower a look's render size (not below 640x360) and capture rate (not below 24 fps) without asking; the 4-look cap does not move.
- A face on a source that is not showing must not run its shader (`setActive(false)`); a hidden look costs nothing.
- Only the strict parser (`src/surfaces/parse.ts`) turns outside data into faces; unknown fields are dropped.
- Do not start the dev server unprompted (8 GB machine); use `npm run build && npm run preview` for a browser. Stage only your own files (`git add <paths>`). Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- An old face list / setup / autosave with none of the new fields loads as all Video and no look field is written for a Video face (Task 2).
- A file or channel message with more than 4 look owners, a link to a missing face, a self link, a link to a non-owner, or a face with both `look` and `lookOf`: normalised exactly as in Global Constraints, identically on every entry path, and an unknown `source` string rejects the whole list (Task 2).
- Randomizing, shuffling or changing speed of one look changes no other look's picture or settings; sharers move together (Tasks 1 and 7).
- Browser cannot make generators (`createGeneratorSource()` returns null) or the pattern: faces fall back to video/pattern/none, no crash, no stuck black (Tasks 3, 4, 6).
- A late-joining Output window (opened after looks are running) receives faces AND each look's state on `hello` and shows the same picture; switching a face's source never shows black or another face's picture for a frame (Tasks 6 and 7).

---

### Task 1: Look settings and per-look runtime reconcile (pure)

**Files:**
- Create: `src/generator/settings.ts`, `src/generator/looks.ts`
- Test: `src/generator/settings.test.ts`, `src/generator/looks.test.ts`

**Interfaces:**
- Consumes: `Look`, `StylePick`, `isValidLook` (`src/generator/look.ts`); `GeneratorState`, `SHUFFLE_CHOICES`, `isValidState` (`shuffle.ts`); `SPEED_MIN/SPEED_MAX` (`speed.ts`); `Surface` (`src/surfaces/types.ts`, extended in Task 2 with `look?: LookSettings`).
- Produces (settings.ts): `interface LookSettings { look: Look; speed: number; shuffleSec: 0|15|30|60; stylePick: StylePick }`; `const DEFAULT_LOOK_SETTINGS: LookSettings` (plasma, seed 1, speed 1, shuffleSec 0, stylePick 'auto'); `isValidLookSettings(x: unknown): x is LookSettings`; `parseLookSettings(raw: unknown): LookSettings | null` (rebuilds from validated fields only); `newLookSettings(rng: () => number, base?: LookSettings): LookSettings` (a fresh random look; speed/shuffle/stylePick copied from `base` when given, else defaults); `stateFromSettings(s: LookSettings, now: number): GeneratorState` (`on: true`, `prev: null`, `changedAt/startedAt/speedChangedAt: now`, `timeAnchor: 0`); `settingsFromState(state: GeneratorState): LookSettings`; `sameSettings(a: LookSettings, b: LookSettings): boolean`.
- Produces (looks.ts): `type LookStates = Record<string, GeneratorState>` (keyed by owner face id); `reconcileLooks(prev: LookStates, list: Surface[], now: number): LookStates` - one entry per look-owning face; keeps an existing state when `sameSettings(settingsFromState(prev[id]), face.look)`, otherwise rebuilds with `stateFromSettings(face.look, now)`; drops states of faces that no longer own a look; returns `prev` itself when nothing changed; `withLookSettings(list: Surface[], ownerId: string, state: GeneratorState): Surface[]` - writes `settingsFromState(state)` into that owner face's `look` (same array when equal, other faces untouched).

- [ ] **Step 1: Write failing tests.** settings.test.ts: `parseLookSettings` accepts a valid object and drops unknown keys; rejects bad style, non-finite seed, speed outside 0.25..2, `shuffleSec: 7`, `stylePick: 'x'`; `stateFromSettings` gives `on: true`, `prev: null`, `timeAnchor: 0`, all three clocks equal to `now`; `settingsFromState(stateFromSettings(s, 5))` equals `s`; `newLookSettings(rng, base)` copies speed/shuffle/pick from `base` and differs in look. looks.test.ts: `reconcileLooks({}, list, 1)` creates a state for each look-owning face only (a Video face and a sharer get none); calling it again with the result returns the SAME object; changing one owner's `look.seed` rebuilds only that owner's state (others keep their object identity); an owner whose face left the list is dropped; `withLookSettings` after `randomizeState` writes the new look into only that owner and returns the same list when nothing changed.
- [ ] **Step 2: Run to verify they fail:** `npx vitest run src/generator/settings.test.ts src/generator/looks.test.ts` expects FAIL (modules missing).
- [ ] **Step 3: Implement** both files per the Interfaces block (Task 2's `Surface.look` field may not exist yet: add `look?: LookSettings` and `lookOf?: string` to `Surface` in `src/surfaces/types.ts` in this task, with `export type FaceSource = 'video' | 'pattern' | 'look'`, `FACE_SOURCES`, `sourceOf(s: Surface): FaceSource`; Task 2 builds on them).
- [ ] **Step 4: Run to verify they pass:** same command PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** (`feat(generator): look settings and per-look state reconcile`).

---

### Task 2: Face source model, normalising and strict parsing

**Files:**
- Create: `src/surfaces/sources.ts`
- Modify: `src/surfaces/parse.ts`, `src/surfaces/model.ts` (`removeSurface`, `isValidSurfaces`, `addSurface` unchanged semantics)
- Test: `src/surfaces/sources.test.ts`, `src/surfaces/parse.test.ts`, `src/surfaces/model.test.ts`

**Interfaces:**
- Consumes: `LookSettings`, `DEFAULT_LOOK_SETTINGS`, `parseLookSettings`, `newLookSettings` (Task 1); `sourceOf`, `FACE_SOURCES` (Task 1).
- Produces (sources.ts): `MAX_LOOKS = 4`; `lookOwners(list: Surface[]): Surface[]` (faces with `source === 'look'` and a `look`, in list order); `ownerOf(list: Surface[], face: Surface): Surface | null` (the face itself if it owns a look, else its valid `lookOf` target, else null); `canStartLook(list: Surface[]): boolean` (`lookOwners(list).length < MAX_LOOKS`); `normalizeSources(list: Surface[]): Surface[]` (applies every repair rule in Global Constraints; strips `look`/`lookOf` from Video and Pattern faces; a Video face never carries a `source` key; idempotent; returns the same array when nothing changes); `setFaceSource(list, id, source: FaceSource, makeLook: () => LookSettings): Surface[]` (to `'look'`: becomes an own look from `makeLook()` unless `!canStartLook` and the face is not already an owner, then the same list; to `'video'`/`'pattern'`: strips look fields; if it owned a look others share, promote the first sharer in list order to owner with that look and re-point the other sharers to it); `shareLook(list, id, ownerId): Surface[]` (same list unless `ownerId` is a different look owner; the face becomes `source: 'look'`, `lookOf: ownerId`, no `look`; if it owned a look with sharers, promote as above); `setOwnLook(list, id, settings: LookSettings): Surface[]` (writes `look` on an owner face only).
- Produces (model.ts): `removeSurface` promotes the first sharer of a removed look owner (same rule), then `normalizeSources`. `isValidSurfaces` rejects a face whose `source` is present but not in `FACE_SOURCES`.
- Produces (parse.ts): `parseSurface` accepts optional `source` (validated, unknown rejects the list), `look` (via `parseLookSettings`; invalid rejects the list), `lookOf` (string, 1..32 chars); writes no `source` key for Video; `parseSurfaceList` ends with `normalizeSources`.

- [ ] **Step 1: Write failing tests.**
  - sources.test.ts: `normalizeSources` on 5 look-owning faces keeps the first 4 and demotes the 5th to Video (no `source`, `look` or `lookOf` keys), and a face sharing the demoted owner becomes an own look with `DEFAULT_LOOK_SETTINGS`; a sharer whose `lookOf` is a missing id, its own id, or a Video face becomes an own look; a face with both `look` and `lookOf` keeps `look` and drops `lookOf`; a Video face with a stray `look` has it stripped; idempotent (second call returns the same array); an already valid list returns the same array. `setFaceSource(list, 's2', 'look', make)` on a 4-owner list returns the same list when `s2` is Video; `setFaceSource(list, ownerWithSharers, 'video', make)` promotes the first sharer, re-points the others, and keeps their `look` equal to the old owner's; `shareLook` to a non-owner or to itself returns the same list; `shareLook` on an owner that has sharers promotes as above; sharers never count towards `MAX_LOOKS`.
  - parse.test.ts: a list with none of the new fields parses with no `source`/`look`/`lookOf` keys on any face; `source: 'hologram'` rejects the whole list; `source: 'look'` with a valid `look` parses; a bad `look` rejects the list; a sharer with a bad link is repaired not rejected; 5 owners from the wire come out as 4 owners + 1 Video face.
  - model.test.ts: `removeSurface` of an owner with two sharers promotes the first and re-points the second; removing a sharer or a Video face leaves the rest identical.
- [ ] **Step 2: Run to verify they fail:** `npx vitest run src/surfaces` expects FAIL.
- [ ] **Step 3: Implement** per the Interfaces block. Promotion is one internal helper shared by `setFaceSource`, `shareLook`, `removeSurface`.
- [ ] **Step 4: Run:** `npx vitest run` (whole suite; face parsing is used by setups, calibration and the simulator) PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** (`feat(surfaces): per-face source, look sharing, normalising parser`).

---

### Task 3: Resolve what each face shows (pure)

**Files:**
- Create: `src/sources/resolve.ts`
- Test: `src/sources/resolve.test.ts`
- Delete at the end of Task 7 (not here): `src/generator/select.ts` and its test, once nothing imports `pickSource`.

**Interfaces:**
- Consumes: `Surface`, `sourceOf`, `ownerOf` (Tasks 1-2).
- Produces: `type FaceSourceRef = { kind: 'video' } | { kind: 'pattern' } | { kind: 'look'; owner: string } | { kind: 'none' }`; `interface ResolveContext { patternForce: boolean; hasVideo: boolean; patternAvailable: boolean; generatorAvailable: boolean }`; `resolveFaceSources(list: Surface[], ctx: ResolveContext): Map<string, FaceSourceRef>` (one entry per face id); `visibleLookOwners(resolved: Map<string, FaceSourceRef>): Set<string>`.
- Rules: `patternForce && patternAvailable` -> every face `pattern`. Otherwise: source video -> `hasVideo ? video : patternAvailable ? pattern : none`; source pattern -> `patternAvailable ? pattern : hasVideo ? video : none`; source look -> `generatorAvailable && ownerOf(...) ? look(owner id) : (the video rule above)`.

- [ ] **Step 1: Write failing tests** covering: force overrides every source; each source with and without video/pattern/generator available (the fallbacks above); a sharer resolves to its owner's id; two sharers and their owner give one entry in `visibleLookOwners`; a Video face with no video shows the pattern; everything unavailable gives `none`.
- [ ] **Step 2: Run to verify fail:** `npx vitest run src/sources/resolve.test.ts` FAIL.
- [ ] **Step 3: Implement** `resolve.ts`.
- [ ] **Step 4: Run to verify pass:** PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** (`feat(sources): resolve each face's source`).

---

### Task 4: Look pool (one generator per live look)

**Files:**
- Create: `src/generator/pool.ts`
- Test: `src/generator/pool.test.ts`

**Interfaces:**
- Consumes: `GeneratorSource` (`source.ts`), `GeneratorState`.
- Produces: `type LookSource = Pick<GeneratorSource, 'video' | 'setState' | 'setAudio' | 'setActive' | 'ensurePlaying' | 'dispose'>`; `interface LookPool { readonly available: boolean; sync(owners: readonly string[]): void; setState(owner: string, state: GeneratorState): void; setActive(owners: ReadonlySet<string>): void; setAudio(levels: { bass: number; treble: number; vol: number }): void; video(owner: string): HTMLVideoElement | null; ensurePlaying(): void; dispose(): void }`; `createLookPool(factory: () => LookSource | null): LookPool`.
- Behaviour: `sync` creates a source for each new owner (calling `factory`), disposes sources for owners no longer listed, never recreates an existing one; a new source immediately receives the last state set for its owner and the last audio levels; if `factory` returns null `available` becomes false, `video(owner)` is null and nothing throws (it retries on the next `sync` for owners that have none); `setActive` calls `setActive(true)` on listed owners and `false` on all others; `dispose` disposes everything and is safe twice.

- [ ] **Step 1: Write failing tests** with a fake `LookSource` factory recording calls: create/dispose follow `sync`; no recreate; late state/audio delivery to a new source; `setActive` true/false split; null factory gives `available === false`, no throw, `video()` null, and a later successful factory call recovers; `dispose` twice is safe.
- [ ] **Step 2: Run to verify fail:** `npx vitest run src/generator/pool.test.ts` FAIL.
- [ ] **Step 3: Implement** `pool.ts`.
- [ ] **Step 4: Run to verify pass:** PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** (`feat(generator): look pool`).

---

### Task 5: Renderer draws a video per face

**Files:**
- Create: `src/renderer/face-videos.ts`
- Modify: `src/renderer/types.ts`, `src/renderer/webgl2.ts`, `src/renderer/webgpu.ts`
- Test: `src/renderer/face-videos.test.ts`

**Interfaces:**
- Produces (types.ts): `Renderer.setFaceVideos(videos: ReadonlyMap<string, HTMLVideoElement | null>): void` - the video each face shows (a face missing from the map or mapped to null draws nothing); `setVideo(v)` keeps its meaning (every face shows `v`) and replaces any per-face map; calling either replaces the other's setting.
- Produces (face-videos.ts): `distinctVideos<T>(order: readonly string[], pick: (id: string) => T | null): T[]` - the distinct non-null sources used, in first-use order.
- WebGL2: one texture per distinct video element (created lazily, deleted when the element is no longer used, all deleted on `destroy`); once per frame upload each distinct READY video once (`isVideoReady`), then draw faces in list order binding their video's texture; a face whose video is null or not ready is skipped. WebGPU: once per frame one `importExternalTexture` + bind group per distinct ready video, `setBindGroup(0, ...)` per face. Shape coverage, blending and quad output stay exactly as in the face-shapes work.

- [ ] **Step 1: Write failing tests (face-videos.test.ts):** duplicates collapse to one entry in first-use order; nulls are skipped; empty order gives `[]`; works with plain objects as the generic `T`.
- [ ] **Step 2: Run to verify fail:** `npx vitest run src/renderer/face-videos.test.ts` FAIL.
- [ ] **Step 3: Implement** `distinctVideos`, the interface change, and both backends per the Interfaces block.
- [ ] **Step 4: Verify:** `npx vitest run` PASS, `npx tsc --noEmit` clean. (GPU behaviour is checked live in Task 10.)
- [ ] **Step 5: Commit** (`feat(renderer): a video per face, one upload per distinct video`).

---

### Task 6: Channel `looks` message, Output window and simulator feed

**Files:**
- Modify: `src/output/protocol.ts`, `src/ui/useOutputFeed.ts`, `src/sim/SimApp.tsx`
- Test: `src/output/protocol.test.ts`

**Interfaces:**
- Consumes: `LookPool`/`createLookPool` (Task 4), `resolveFaceSources`/`visibleLookOwners` (Task 3), `Renderer.setFaceVideos` (Task 5), `reconcileLooks`, `stateFromSettings` (Task 1), `lookOwners` (Task 2).
- Produces (protocol.ts): the `generator` message is REPLACED by `{ type: 'looks'; states: Record<string, GeneratorState> }` (owner face id -> state): at most `MAX_LOOKS` entries, keys non-empty strings up to 32 chars, each value passing `isValidState`, rebuilt from validated fields (the clean-rebuild block now in the `generator` case moves to a helper). `parseMsg` rejects the whole message on any bad entry.
- Produces (useOutputFeed.ts): the hook keeps its signature `useOutputFeed(renderer, onSurfaces?)` and returns `{ resumeVideo, setUniformSource }` where `setUniformSource(on: boolean)` makes every face show the same fallback picture (video, else pattern) and ignore looks (the simulator uses it while it shows its own solved layout, whose ids collide with app ids). Inside: keeps the latest surfaces and `looks` states, owns the pool, the pattern source and the video; on `surfaces` / `looks` / `pattern` / `video` messages it re-resolves with `resolveFaceSources` and calls `pool.sync`, `pool.setState`, `pool.setActive(visibleLookOwners)` and `renderer.setFaceVideos`; `audio` messages go to `pool.setAudio`; on unmount everything is disposed. A look whose owner has no `looks` state yet is built from the face's `look` settings with `stateFromSettings(…, Date.now())`.
- SimApp: call `setUniformSource(mode === 'solved')` whenever its mode changes.

- [ ] **Step 1: Write failing tests (protocol.test.ts):** a `looks` message with two valid states round-trips; 5 entries, an empty key, a 40-char key, an invalid state and a non-object `states` each return null; the old `generator` type now returns null; existing message tests still pass.
- [ ] **Step 2: Run to verify fail:** `npx vitest run src/output/protocol.test.ts` FAIL.
- [ ] **Step 3: Implement** protocol, `useOutputFeed` and the SimApp wiring.
- [ ] **Step 4: Verify:** `npx vitest run` PASS; `npx tsc --noEmit` clean (the Editor still sends `generator` until Task 7, so its `postMessage` calls compile because `postMessage` takes `any`; they are removed there).
- [ ] **Step 5: Commit** (`feat(output): per-face sources and the looks message`).

---

### Task 7: Editor engine: looks, sources, shuffle, audio

**Files:**
- Create: `src/ui/useLooks.ts`
- Modify: `src/ui/Editor.tsx`, `src/ui/useAudioReactor.ts`, `src/generator/remember.ts` (seeding only), `src/generator/select.ts` and `select.test.ts` (delete)
- Test: `src/generator/looks.test.ts` (extend), `src/audio/reactor-logic.test.ts` unchanged

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces (useLooks.ts): `useLooks(args: { renderer: Renderer | null; store: KeyValueStore | null; channelRef: MutableRefObject<BroadcastChannel | null>; surfacesRef: MutableRefObject<Surface[]>; publish: (list: Surface[]) => void; applySourcesRef: MutableRefObject<() => void> })` returning `{ looks: LookStates; looksRef: MutableRefObject<LookStates>; pool: LookPool; available: boolean; reconcile(list: Surface[]): void; updateLook(ownerId: string, next: GeneratorState): void; beatRandomize(now: number): void; newLookSettings(): LookSettings; broadcast(): void }`.
  - `reconcile(list)`: sets `looksRef = reconcileLooks(...)`, `pool.sync(owner ids)`, pushes each state to the pool, and broadcasts when anything changed. Called from `publish` for every face-list change.
  - `updateLook(owner, next)`: stores the state, `pool.setState`, `publish(withLookSettings(surfacesRef.current, owner, next))`, broadcasts `{ type: 'looks', states }`, calls `applySourcesRef.current()`. Faces sharing the owner move with it automatically (they resolve to the owner's id).
  - `beatRandomize(now)`: for every look in `looksRef` that is visible and passes `shouldBeatRandomize({ beat: true, settings, generatorOn: true, listening: true, now, changedAt: state.changedAt })`, `updateLook(id, randomizeState(state, now, Math.random))`. Each look is throttled by its own `changedAt` (6 s).
  - A 1 s interval randomizes any visible look whose `shuffleDue(state, now)`.
  - `newLookSettings()` seeds from the remembered `loadGeneratorState(store, …)` (style pick, shuffle, speed) with a fresh random look; every look change also calls `saveGeneratorState(store, state)` so the last-used style carries over.
  - On Editor mount, a new Output window's `hello` is answered with `surfaces`, `pattern` and `looks`.
- Editor.tsx: remove `genState`/`genStateRef`/`genSourceRef`/`genAvailable`/`updateGenerator`, the single generator effect, the single shuffle timer and the single remember effect; the old `applySource` becomes `applySources` (resolve with `{ patternForce, hasVideo, patternAvailable, generatorAvailable: pool.available }`, `pool.setActive(visibleLookOwners)`, `renderer.setFaceVideos(map face id -> pool.video / pattern.video / video.video / null)`); `publish` also calls `looks.reconcile(list)` and `applySources()`; `adoptLayoutRef` (Setups load, simulator Send, Start fresh) goes through `publish` so looks reconcile. Start fresh keeps one default Video face.
- useAudioReactor.ts: arguments become `{ channelRef, poolRef, onBeat }`; `sendLevels` posts the `audio` message and calls `poolRef.current?.setAudio`; the beat branch calls `onBeat(now)` (which is `looks.beatRandomize`).

- [ ] **Step 1: Write failing tests (extend looks.test.ts for the pure parts):** `reconcileLooks` keeps an owner's state identity when only another owner changes; a Setups-style replacement of the list with the same ids but different `look` settings rebuilds only the changed owner; sharers get no state. (The hooks themselves are DOM/React and are checked in Task 10, as the repo already does for `useAudioReactor`.)
- [ ] **Step 2: Run to verify fail:** `npx vitest run src/generator/looks.test.ts` FAIL on the new cases (add any missing pure helper they need to `looks.ts`).
- [ ] **Step 3: Implement** `useLooks.ts` and the Editor / audio reactor changes above; delete `select.ts`/`select.test.ts` once `grep -rn pickSource src` is empty.
- [ ] **Step 4: Verify:** `npx vitest run` PASS; `npx tsc --noEmit` clean; `npm run build` succeeds.
- [ ] **Step 5: Commit** (`feat(editor): per-face looks engine, sources resolved per face`).

---

### Task 8: Editor controls: Source picker, sharing, per-face Visuals panel

**Files:**
- Modify: `src/ui/SurfaceBar.tsx`, `src/ui/GeneratorPanel.tsx`, `src/ui/generator-actions.ts`, `src/ui/slice-aspect.ts`, `src/ui/Editor.tsx`
- Test: `src/ui/generator-actions.test.ts`, `src/ui/slice-aspect.test.ts`

**Interfaces:**
- Consumes: `setFaceSource`, `shareLook`, `lookOwners`, `ownerOf`, `canStartLook` (Task 2); `useLooks` (Task 7).
- SurfaceBar: a **Source** row under the Shape row with three 44 px buttons Video / Test pattern / Visual look (props `selectedSource: FaceSource`, `onSetSource(source)`); when the selected face is on Visual look a second row shows **Own look** and one button per OTHER look-owning face ("Same as Face N"), props `lookChoice: { mode: 'own' } | { mode: 'shared'; ownerId: string }`, `owners: { id: string; label: string }[]`, `onOwnLook()`, `onShareLook(ownerId)`. The Visual look button is disabled (with a title explaining the 4-look cap) when `!canStartLook(list)` and the face is not already on a look; sharing is always enabled.
- GeneratorPanel: props change from `state/available/onChange` to the SELECTED face's look: `{ faceLabel: string; hasLook: boolean; state: GeneratorState | null; available: boolean; patternForce: boolean; onChange(next: GeneratorState): void; onUseLook(): void; audio: SoundProps; onClose }`. The title says "Face N's look" (or "shared with Face M" when the face is a sharer, editing the owner's look). The On/Off switch is removed. When `!hasLook` the Look/Randomize/Shuffle/Speed controls are replaced by one "Switch Face N to a visual look" button (`onUseLook`, disabled with the cap title when `!canStartLook`). Randomize no longer turns anything on. The Sound section is unchanged and global. The toolbar **Visuals** button just opens the panel (label no longer says on/off).
- generator-actions.ts: remove `setOn` and make `randomizeOn`, `applyCode`, `pickStyle` take a state that is always on (rename `randomizeOn` to `randomizeLook`); behaviour of fade/clock handling unchanged.
- slice-aspect.ts: the slice box shape is decided per face (look and pattern faces are 16:9, Video faces use the loaded video's shape); signature becomes `sliceAspect(input: { source: FaceSource; patternForced: boolean; videoAspect: number | null }): number` (read the current file first and keep its existing 16:9 constants).

- [ ] **Step 1: Write failing tests:** generator-actions.test.ts: updated expectations (a look is always on; `randomizeLook` keeps clocks, cross-fades to a new look; `applyCode` with a bad code returns `{ ok: false }`); slice-aspect.test.ts: look and pattern faces give 16/9, a Video face gives the video aspect, a forced pattern gives 16/9.
- [ ] **Step 2: Run to verify fail:** `npx vitest run src/ui/generator-actions.test.ts src/ui/slice-aspect.test.ts` FAIL.
- [ ] **Step 3: Implement** the controls and Editor wiring (`onSetSource` uses `setFaceSource(list, id, source, looks.newLookSettings)`; `onShareLook` uses `shareLook`; both go through `publish`).
- [ ] **Step 4: Verify:** `npx vitest run` PASS; `npx tsc --noEmit` clean; `npm run build` succeeds.
- [ ] **Step 5: Commit** (`feat(ui): per-face source picker, look sharing, per-face Visuals panel`).

---

### Task 9: Render budget (look size) and phone safety

**Files:**
- Modify: `src/generator/source.ts`, `src/generator/pool.ts`, `src/ui/useLooks.ts`
- Create: `src/generator/budget.ts`
- Test: `src/generator/budget.test.ts`, `src/generator/pool.test.ts` (extend)

**Interfaces:**
- Produces (budget.ts): `lookRenderSize(liveLooks: number): { w: number; h: number }` - 960x540 for 0..2 live looks, 640x360 for 3..4; `captureFpsFor(liveLooks: number): 30`; (the capture rate stays 30; the builder may lower it to 24 for 4 looks only if the live check in Task 10 shows it is needed and records that in the ledger).
- Produces (source.ts): `GeneratorSource.setSize(w: number, h: number): void` (resizes the hidden canvas and the viewport/`u_res`; no-op when unchanged; the first frame after a resize is drawn immediately so the stream never shows a black frame). `GENERATOR_WIDTH/HEIGHT` stay the default size so zero-reaction output at the default size is unchanged.
- `LookPool.setSize(w, h)` applies to every source and to ones created later; `useLooks` and `useOutputFeed` call it with `lookRenderSize(visibleLookCount)` whenever the set of visible looks changes.

- [ ] **Step 1: Write failing tests:** budget.test.ts: sizes for 0,1,2,3,4 live looks; pool.test.ts: `setSize` reaches existing and later-created sources and repeats are harmless.
- [ ] **Step 2: Run to verify fail:** `npx vitest run src/generator/budget.test.ts src/generator/pool.test.ts` FAIL.
- [ ] **Step 3: Implement** the helper, `setSize`, the pool method and the two call sites.
- [ ] **Step 4: Verify:** `npx vitest run` PASS; `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** (`feat(generator): smaller look render size when 3-4 looks are live`).

---

### Task 10: Pass-through tests, live check, docs

**Files:**
- Test: `src/setups/setups.test.ts`, `src/calibrate/corners.test.ts`, `src/sim/solve.test.ts`, `src/surfaces/glue.test.ts`
- Modify: `README.md`, `docs/superpowers/specs/2026-10-18-per-face-content-as-built.md` (create)

**Interfaces:** Consumes everything above; no new code interfaces.

- [ ] **Step 1: Add pass-through tests.** setups: a setup with a Video face, a Pattern face, an owner with a look and two sharers round-trips through export/import and autosave with identical `source`, `look`, `lookOf`; an old setup file with none of the fields loads as all Video; an imported file with 5 look owners loads with 4 owners and 1 Video face; `source: 'hologram'` rejects. calibrate: `applyCalibration` keeps `source`, `look`, `lookOf`. sim: `toSurfaces` faces carry no `source` key. glue: a pin shared by a look face and a Video face still moves both and keeps their sources.
- [ ] **Step 2: Run:** `npx vitest run` PASS; `npm run build` succeeds.
- [ ] **Step 3: Live pixel check in headless Chrome** (swiftshader, WebGL2 forced with `?renderer=webgl2`; script in the session scratchpad, not the repo; bundle with `npx esbuild` and open from `file://` as the shapes check did; do not start the dev server). Build a harness that creates the real `createLookPool` + `resolveFaceSources` + a `webgl2` renderer with three shaped faces: a circle on an own look, a triangle on Test pattern, a quad sharing the circle's look, plus a second own look on a fourth face. Assert: the two own looks give different pixel content in their faces; the sharer matches its owner's picture (same look, its own slice); the pattern face shows the pattern's black/white grid colours; randomizing look A (via `randomizeState` + `pool.setState`) changes face A's pixels and leaves look B's face pixels identical; switching the pattern face to Video with no video falls back to the pattern without a black frame; with the factory forced to return null every face is non-crashing and falls back; faces outside shapes stay black. Also screenshot it and look at it. WebGPU cannot run headless here (no adapter): say so, and have Lyndz check `?renderer=webgpu` in a real browser.
- [ ] **Step 4: Ask Lyndz to run it on the laptop** (not automatable): 4 looks at once, frame rate, heat, one microphone driving all, Output window mirrors the Editor, Randomize on one shape leaves the others alone. Record the result in the as-built note; if the 4-look budget is missed, report it rather than shipping.
- [ ] **Step 5: Docs.** README: a "Different content on each shape" section (Source row, own vs shared look, the 4-look cap, Test pattern button is wall-wide, Visuals panel edits the selected face, one microphone), plus Status/Known limits (not checked on real hardware). As-built note: the architecture (pool of `GeneratorSource`s, `setFaceVideos`, `looks` message, `useLooks`), the rules in Global Constraints, what was and was not verified, and that WebGPU per-face was not run live. Update memory file `hypermapping-app-m1-m3-2026-10-14.md`.
- [ ] **Step 6: Commit** (`test+docs: per-face content pass-through checks, as-built note, README`).
