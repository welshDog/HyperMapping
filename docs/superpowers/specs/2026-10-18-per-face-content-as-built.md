# Per-face content: as built (2026-10-19)

Design: `2026-10-18-per-face-content-design.md`. Plan: `../plans/2026-10-18-hypermapping-per-face-content.md`. Branch `feat/per-face-content` (not merged).

## What was built

- **Face data.** `Surface.source?: 'video' | 'pattern' | 'look'` (missing = Video, and a Video face never carries the key), `look?: LookSettings` on a face that owns a look, `lookOf?: string` (a face id, never a list position) on a face that shares one. `LookSettings` (`src/generator/settings.ts`) is the saved part of a look: style + seed, speed, shuffle, style pick. `on` and the clocks are never saved.
- **One normalising function** (`normalizeSources`, `src/surfaces/sources.ts`) runs wherever a face list comes in: the strict parser (`parseSurfaceList`, used by Setups load/import, autosave restore and every channel message), `removeSurface` and the source/share edits. Rules: at most `MAX_LOOKS = 4` look owners (sharers count once); the first 4 owners in face order stay, extra owners drop to Video; a sharer of a demoted or missing owner, of itself or of a non-owner is repaired (own default look while a slot is free, else Video), never rejected; an unknown `source` string rejects the whole list. Deleting or switching away an owner that others share promotes the first sharer (same settings) and re-points the others.
- **What each face shows** is decided by one pure function, `resolveFaceSources` (`src/sources/resolve.ts`): Test pattern button forces the pattern everywhere; Video falls back to the pattern when no video is loaded; a look face falls back to the video (then the pattern) when its generator does not exist (`generatorAvailable` can be a per-owner check, `pool.hasSource`). `visibleLookOwners` lists the looks actually on screen.
- **Look pool** (`src/generator/pool.ts`): one existing `GeneratorSource` (hidden WebGL2 canvas -> `captureStream` -> hidden video) per live look, created by an injected factory. `sync(owners)` creates/disposes, never recreates; a new source gets the last state, audio levels and size at once; a null factory makes `available` false without throwing; `setActive` switches off the shader of every look that is not on screen; `rekey(from, to)` moves a source (and its remembered state) to a new owner id; `setSize` sets the render size of every source.
- **Renderer**: `setFaceVideos(map face id -> video)` (WebGL2 and WebGPU). Each distinct video is uploaded once per frame however many faces use it; a face whose video is not ready yet is not drawn (black) for that frame.
- **Channel**: the old `generator` message is gone; the Editor sends `looks` (state of each live look, keyed by owner face id, at most 4; a null-prototype map after `parseMsg`) next to `surfaces`, `pattern` and `audio`. `useOutputFeed` (`src/ui/useOutputFeed.ts`) is the Output window / simulator side: it keeps the faces, the looks, the pool, the pattern and the video and re-resolves everything on any change. A late-joining Output window gets faces and looks on `hello`.
- **Editor engine**: `useLooks` (`src/ui/useLooks.ts`) owns the per-look states (`reconcileLooks`, `withLookSettings`, `carryToHeirs`), the Editor's own pool, shuffle and beat targets over visible looks only, and broadcasting.
- **Hand-over**: `lookHandovers(prev, next)` (`src/generator/looks.ts`) finds which looks changed owner through a real sharing link (never equal settings). Both the Editor and the Output window call `pool.rekey(from, to)` BEFORE `sync`, so the heir keeps the same generator and video element and the picture carries on without a black frame (`carryToHeirs` keeps the running state).
- **UI**: Source row (Video / Test pattern / Visual look) and a Look row (Own look / Same as Face N) in the face bar; the Visuals panel edits the selected face's look (or the look it shares); the Sound section stays global. At the cap the own-look buttons are disabled with a tooltip; sharing stays possible.
- **Budget lever** (`src/generator/budget.ts`): with 3 or 4 visible looks every look renders at 640x360 instead of 960x540 (`pool.setSize`, called before `setActive`). Capture rate stays 30 fps (`captureFpsFor` is a stub that may drop to 24 only if the laptop check says so). The 4-look cap does not move.
- **Sound**: one microphone in the Editor; every live look gets the same levels.

## Checks

- 683 vitest tests, `tsc --noEmit` clean, `npm run build` passes. Task 10 pass-through tests (they passed first time; they pin behaviour earlier tasks produced): setups export/import, saved setup and autosave keep `source`/`look`/`lookOf`; an old file loads as all Video; 5 imported owners become 4 + 1 Video; `source: 'hologram'` rejects the file; `applyCalibration` keeps the fields; simulator `toSurfaces` faces carry none of them; a glued pin shared by a look face and a Video face moves both and keeps their sources.
- **Live pixel check, headless Chrome, swiftshader, WebGL2** (harness in the session scratchpad, not the repo; real `createLookPool(createGeneratorSource)`, `resolveFaceSources`, `createPatternSource`, the WebGL2 renderer with `setFaceVideos`, `lookHandovers` + `rekey`, `lookRenderSize` + `setSize`; plus one phase that mounts the real `useOutputFeed` hook and drives it over the BroadcastChannel). Wall clock frozen so looks are still pictures. All 50+ assertions passed:
  - a circle on its own look and a quad on a second own look differ (mean diff ~104/255); the sharer quad uses the very same video element and matches its owner exactly (diff 0); with its own right-half slice it matches the owner at the same look coordinates (diff ~6) and not at the same frame position (~61);
  - the triangle on Test pattern shows the pattern's colours (it is dark navy with grey/cyan lines, not black and white as the brief said);
  - Randomize look A: face A and its sharer change, look B's 25,600 pixels are identical (0 differ), in the copied apply and through the real hook;
  - the pattern face switched to Video with no video: same pattern element, pattern on every frame after the switch;
  - deleting a shared look's owner: hand-over found, no new generator made, same video element, the heir lit on every one of 6 consecutive frames and its picture unchanged (diff 0), also through the real hook (before and after the Editor's `looks` message). Control: the same deletion WITHOUT `rekey` makes a new generator and shows 4 black frames, so the check can see the bug the hand-over fix prevents;
  - 4 live looks: every look renders at 640x360 (`videoWidth` 640), existing faces stay lit on every frame through the resize, all 4 looks lit and different; back to 2 looks -> 960, still lit;
  - generator factory returning null: no throw, `available` false, look faces get the pattern element and show the pattern;
  - pixels outside the shapes (circle and triangle frame corners, gaps) stay exactly black in every phase.
- Screenshots looked at: four faces (plasma circle, its sharer quad, pattern triangle, neon quad) and the 4-look layout (kaleidoscope circle, particles quad).

## Not verified (pending Lyndz on the laptop and phone)

- 4 looks at once: frame rate (target steady 30 fps) and heat; if the target is missed, report it rather than ship (the lever is render size / capture rate, not the cap).
- One microphone driving all looks with real music.
- The Output window mirroring the Editor face by face; Randomize on one shape leaving the others alone, by eye.
- `?renderer=webgpu` in a real browser (headless has no WebGPU adapter; the WGSL per-face path was not run live).
- Phone: heat and frame rate with 2-4 looks (cheap shader mode).
- Swiftshader is a software renderer: a brand-new look took ~6-7 s to show its first frame there and a randomized look up to ~5-12 s to reach the screen. No performance number is claimed from it. A brand-new look's face is black until its stream has a first frame (by design the renderer skips unready videos); on real hardware this should be a few frames, worth watching.

## Deferred minors (from the reviews)

- Renderer: one throwing video upload blanks every face (wrap per-video upload); stale texture while the loop is stopped.
- Pool: `available` reflects the last sync only; a throwing factory/dispose aborts partway; `setSize` before `setState` on a new source; no NaN guard in `setSize`.
- Budget: no hysteresis at the 2/3-look boundary (flapping between sizes when a look toggles); `captureFpsFor` is a stub.
- Editor: misleading cap notice when re-pressing Own look, literal 4 in a notice; hidden look shuffle timer keeps counting; double broadcast on the Off-draft path.
- Tests: some resolve/pool/normalise edge cases (listed in the SDD ledger).
