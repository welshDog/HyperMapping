# HyperMapping — Random visuals generator Design Spec

Builds on the Editor, the Output window, the simulator and the test pattern. Implemented by `docs/superpowers/plans/2026-10-15-hypermapping-random-visuals.md`; extended by `2026-10-15-sound-and-speed-design.md`.

## Context
HyperMapping could map a video (or the test pattern) onto a box, but the only pictures were ones you loaded. Lyndz wanted a cool random pattern generator: endless, good-looking visuals on every face with no video file, and one tap to get something new. This is the "generative visuals" milestone of the original design.

Agreed with Lyndz:
- **All four looks:** flowing colour (plasma/noise), kaleidoscope/mandala, neon geometry (tunnels, rings, a grid floor), particles (stars, fireflies, rain).
- **Randomize button + auto-shuffle:** one tap picks a new look, colours and seed; an optional timer reshuffles every 15, 30 or 60 seconds with a smooth cross-fade. Every result has a short code that brings the same look back.
- **Audio later:** the shaders take a pulse input from the start (sound reaction was built afterwards, see the sound spec).
- Out of scope: saving looks with setups, a favourites list, user-written shaders, 3D scenes.

## Approach
Reuse the technique the test pattern proved: draw on a hidden canvas, expose it as a live `<video>` through `captureStream`, hand it to `Renderer.setVideo`. **No renderer or warp changes.** The generator draws with ONE full-screen WebGL2 fragment shader (960×540, about 30 fps), so it costs the GPU little even on a phone.

Windows stay in step cheaply: the Editor owns a small **generator state** (`on`, the current and previous look, `changedAt`, `shuffleSec`, `startedAt`, `stylePick`, plus the speed fields) and broadcasts it as a `generator` channel message (also in the `hello` reply and the creation broadcast, like `pattern`). The Output window and the simulator each render their own generator from the same state; the shaders are deterministic in (look, time), so every window shows the same picture without streaming video.

**Source priority** (one pure function, `src/generator/select.ts`, used everywhere): test pattern forced > generator on > video loaded > test pattern fallback.

## The look and its code
- A look is only `{ style, seed }` (seed = unsigned 32-bit integer). The palette (an IQ cosine palette) and the look's own speed are derived from the seed by pure functions, so the code reproduces the look exactly.
- Code format `<letter>-<8 hex digits><check digit>`, e.g. `K-7F3A92C1B` (letters P plasma, K kaleidoscope, N neon, S particles). The check digit is a **weighted** sum of the eight hex digits (weights 1, 3, 5, 7, 9, 11, 13, 15) mod 16, so every single wrong digit is caught and almost every swap of neighbouring digits is too (a swap of two digits that differ by exactly 8 is not). Parsing accepts any case, surrounding spaces and a missing dash; it rejects a wrong letter, length, non-hex or a bad check digit.
- Cross-fade 1.5 s (smoothstep) between the previous and current look.

## Shaders
One fragment shader, GLSL ES 3.00: shared integer hash, noise, fbm, palette, vignette and tone map, plus four look functions: plasma (domain-warped fbm), kaleidoscope (polar fold with 5 to 12 segments), neon (scrolling polygon or circle rings, spokes, a grid floor with a horizon haze), particles (three parallax layers; seeds pick fireflies, stars or rain). Cheap mode (3 noise octaves instead of 5) is used on touch devices. Everything is deterministic in its uniforms: no wall clock and no randomness inside a shader.

## The source (`src/generator/source.ts`)
`createGeneratorSource()` returns a source with `video`, `setState`, `setActive`, `setAudio`, `ensurePlaying` and `dispose`, or `null` (never throws) when the browser cannot do it, in which case the Visuals button is greyed out. It runs one loop (rAF, with a timer fallback when hidden), throttled to about 30 fps, draws nothing while the generator is off or another source is showing (`setActive`), draws one frame immediately on switch-on, recovers from a lost graphics context, and releases everything on dispose.

## The panel and the Editor
A **Visuals** toolbar button opens a panel: On/Off, the Look picker (Auto or one fixed style; picking a style switches to it at once when the visuals are on), **Randomize**, Auto-shuffle, the code with **Copy** and **Use code**, a hint when the test pattern is hiding the visuals, then Speed and Sound (see the sound spec). The last look, shuffle choice and style pick are remembered in browser storage (guarded); the visuals always start Off after a reload.

## Edge cases (tested where pure)
Determinism of palette and speed per seed (including seeds 0 and 2^32−1); all four styles reachable; codes round-trip for every look and reject corrupted codes; fade maths; shuffle schedule (changing the shuffle time never shuffles at once); `pickSource` over all 32 input combinations; the `generator` message parser rejects every malformed field and rebuilds a clean copy; remembered state falls back safely on junk.

## Risks and known limits
- `captureStream` from a WebGL canvas on iOS Safari is unverified; if unsupported the button greys out.
- Plasma and kaleidoscope are the heaviest looks; phones use the cheaper version and the frame rate over a long session is not yet measured.
- Auto-shuffle runs in the Editor tab and is slowed by browsers when that tab is hidden.
- Two different 32-bit seeds can, very rarely, give the same shader seed (the seed is folded to 24 bits for the GPU); their palettes and speeds still differ.
