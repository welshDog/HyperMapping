# HyperMapping — Design Spec (web-first projection mapping for phones)

## Context
`HyperMapping/` currently holds only a Gemini chat export (10 text files, a PDF, 3 diagram HTMLs). It is an idea trail, not code. Lyndz wants a **personal/creative projection-mapping tool** for a modern phone + projector. Device and connection are undecided, so we start **web-first** and keep a path to native.

Agreed with Lyndz:
- Purpose: personal/creative tool (no tiers, no store launch, no Pi/Docker cluster, no competitor positioning).
- Approach: **WebGPU PWA with a swappable renderer interface (WebGL2 fallback)**; native shell later.
- v1 scope: homography corner-pin + local video (core), plus scenes save/load, bezier/mesh warp, generative/audio-reactive visuals, camera auto-calibration — delivered as ordered milestones.

## Corrections to the source transcripts (design-relevant)
1. Bilinear mesh is NOT perspective-correct. For 4-corner pin, position mesh vertices with a **3x3 homography**; use bezier/mesh patches only for curved surfaces.
2. USB-C HDMI usually **mirrors** the screen (editor UI would show on the projector). v1 needs an **output-only fullscreen mode** and a **second-window `/output` route**; true extended display needs the native step.
3. "Bypass the CPU" = `importExternalTexture` from `<video>` in WebGPU / `texImage2D(video)` in WebGL2; decoder is browser-controlled.
4. The 20x20 mesh update (~3 KB/frame) is not the bottleneck; decode, thermals and memory are.
5. Camera auto-calibration via projected patterns (ArUco/structured light) works on any phone; LiDAR not needed.

## Architecture
- `renderer/` — interface `Renderer { init(canvas), setSurface(id, mesh), setSource(id, source), draw() }` with `webgpu.ts` and `webgl2.ts` implementations; feature-detect at startup. Pure module, no React.
- `warp/` — pure math: `homography(corners)`, `meshFromHomography`, `meshFromBezier`, NDC conversion (Y flip). Unit-tested.
- `ui/` — React + Tailwind. SVG overlay for pins/handles; drag state in refs (no re-render per pointermove), `touch-none`, pointer capture. Modes: edit / play / output-only.
- `sources/` — video file, generative shaders, mic analyser (WebAudio) feeding shader uniforms.
- `calibrate/` — camera capture, pattern generator, marker detection, solves homography per surface.
- `scenes/` — JSON schema (surfaces, mesh, source refs, version) in IndexedDB; export/import file.
- `output/` — `/output` route driven via `BroadcastChannel` (same-origin second window) with a clean fullscreen canvas.
- Thermal guard: adaptive resolution scale / 60→30fps drop on frame-time degradation.

## Milestones (each independently usable)
1. **Core**: renderer interface + WebGPU/WebGL2, homography corner-pin, local video, output-only mode.
2. **Scenes**: JSON schema, IndexedDB save/load, export/import.
3. **Mesh warp**: bezier/grid control points, multi-surface.
4. **Generative + audio-reactive**: shader sources, mic uniforms.
5. **Auto-calibration**: camera pattern capture to homography.
6. **(Later) Native shell**: Capacitor/native for true extended display, if device warrants.

### Status (updated 2026-10-15)
| Milestone | State | Where it is documented |
|---|---|---|
| 1. Core | Built and checked on laptop and phone. | `plans/2026-10-14-hypermapping-m1-core.md` |
| 2. Scenes | Built as **Setups** (save/load, export/import, remembered last layout). It stores layouts in browser localStorage, not IndexedDB, and does not save the video. | `specs/2026-10-14-save-load-design.md` |
| 3. Mesh warp / multi-surface | **Multi-surface (box mapping) built**: up to 6 faces, slices, glued corners. Bezier/mesh patches for curved surfaces were **not** built. | `specs/2026-10-14-multi-surface-design.md`, `specs/2026-10-14-glued-corners-design.md` |
| 4. Generative + audio-reactive | **Built**: four random looks with Randomize, auto-shuffle, codes and a speed slider; microphone reaction (bass, treble, volume, beat). The microphone tuning still needs a real-mic test. | `specs/2026-10-15-random-visuals-design.md`, `specs/2026-10-15-sound-and-speed-design.md` |
| 5. Auto-calibration | **Built** with structured-light stripes and tapped corners (not ArUco markers); a phone is the camera. Accuracy on a real box and projector is not yet measured. | `specs/2026-10-15-camera-calibration-design.md` |
| 6. Native shell | Not started. | |

Also built beyond the original list: a 3D **virtual-projector simulator** (`specs/2026-10-14-virtual-projector-design.md`), a built-in **test pattern** (`specs/2026-10-14-test-pattern-design.md`), a bundled **demo video**, and a one-click Windows launcher.

## Critical files to create (greenfield, in `HyperMapping/`)
`package.json` (Vite + React + TS + Tailwind), `src/renderer/*`, `src/warp/*`, `src/ui/*`, `src/sources/*`, `src/scenes/*`, `src/output/*`, `src/calibrate/*`. Keep the Gemini notes in `docs/notes/`.

## Verification
- Unit tests: homography maps unit-square corners exactly; straight lines stay straight (vs bilinear); NDC Y-flip; scene JSON round-trip.
- Run: dev server on LAN, open on the real phone, drag pins, confirm perspective on a wall; check both renderers via forced-fallback flag.
- Output: open `/output` on a second screen/window; confirm editor UI absent.
- Thermal: 20-minute run, log frame times, confirm the adaptive guard triggers.

## Open items (decide during planning, not blocking)
- Exact phone model / projector connection (drives the later native decision).
- Video size limits and format guidance for mobile memory.
