# HyperMapping — Virtual projector (3D simulator + auto-fill pins) Design Spec

Builds on the shipped M1 (single quad, phone-tested) and M3 (multi-face box mapping, committed, not yet phone-tested). See `2026-10-14-hypermapping-design.md` and `2026-10-14-multi-surface-design.md`.

## Context
Mapping a box by dragging 3 x 4 pins by hand is slow. Lyndz started a vanilla Three.js demo (`sim.html`) that wraps a test pattern onto a spinning box. That is a textured box, not projection mapping: a real projector shoots a light cone from one position, and what lands on each face depends on where the projector and box are.

Agreed with Lyndz: build a **virtual projector** that (1) previews the app's real output projected onto a 3D box from a chosen projector position, and (2) computes each visible face's four pins from the box size and projector placement and sends them to the main app. Lens shift is included in the model (default 0).

## Core idea (single source of truth)
A virtual projector is a camera: eye position, aimed at the box centre, vertical field of view derived from the throw ratio and image aspect, optional vertical lens shift. For each box face that points at the projector, its four 3D corners pushed through that camera's view-projection matrix land in the projector image; converted to the app's unit space (0..1, Y down) they ARE that face's four pins. The 3D preview uses the **same matrices** (passed to the shader), so the picture and the pins cannot disagree.

## Maths module — `src/sim/` (pure TypeScript, no DOM, no three)
Units are metres; the box stands on the floor (y from 0 to `height`), centred on the origin, rotated by `yawDeg` about Y.
- `math.ts`: `type V3 = [number, number, number]`; `type Mat4 = number[]` (16 numbers, row-major). `sub`, `cross`, `dot`, `normalize`, `lookAt(eye, target, up?) → Mat4` (world→camera, camera looks down −Z, like OpenGL), `perspective(fovYRad, aspect, near, far, shiftY?) → Mat4`, `mul(a, b)`, `transformPoint(m, p: V3) → [x, y, z, w]`, `toColumnMajor(m) → Float32Array`.
  - Lens shift: `shiftY` is a fraction of the image height; `shiftY > 0` moves the image up on the wall, so a point on the optical axis lands at unit `v = 0.5 + shiftY`. Implemented as `P[1][2] = 2 * shiftY`.
- `box.ts`: `interface Box { width; height; depth; yawDeg }`; `type FaceId = 'front'|'back'|'left'|'right'|'top'|'bottom'`; `interface Face { id: FaceId; corners: V3[] /* 4, world space */; normal: V3 /* outward, unit */ }`; `boxFaces(box) → Face[]` (all six, correct outward normals after yaw).
- `solve.ts`:
  - `interface Projector { distance; azimuthDeg; height; throwRatio; aspect; shiftY }` — `distance` and `azimuthDeg` are measured on the floor from the box centre (azimuth 0 = along +Z); `height` is the lens height above the floor; the projector aims at `(0, box.height / 2, 0)`.
  - `projectorCamera(p, box) → { eye: V3; view: Mat4; proj: Mat4; viewProj: Mat4 }`. `fovY = 2 * atan(1 / (2 * throwRatio * aspect))`.
  - `projectToUnit(viewProj, p: V3) → [number, number] | null` — unit space (`u = x/w*0.5+0.5`, `v = 0.5 - y/w*0.5`); `null` when the point is behind the lens (`w <= 1e-6`).
  - `orderClockwise(points: Vec2[]) → Corners` — sorts by angle about the centroid (screen, Y down → increasing angle is clockwise) and starts at the top-left-most point (`min(x + y)`), giving `{ tl, tr, br, bl }`.
  - `solveFaces(box, projector) → SolveResult` where `SolvedFace = { face: FaceId; corners: Corners; centroidX: number; partlyOutside: boolean }` and `SolveResult = { faces: SolvedFace[]; skipped: { face: FaceId; reason: 'facing-away' | 'behind-projector' | 'off-image' }[] }`.
    - A face is used only if `dot(normal, eye − faceCentre) > 1e-6` (a box is convex, so front-facing faces are not hidden by the box itself).
    - Any corner behind the lens → skipped `behind-projector`. Any corner outside `[-0.5, 1.5]` (the pin editor's clamp) → skipped `off-image`. Corners inside the clamp but outside `[0,1]` → kept, `partlyOutside: true`.
  - `toSurfaces(result) → Surface[]` — faces sorted by `centroidX` ascending; ids `s1…sn` (n ≤ 6); `srcRect` from `defaultSlices(n)` so the video runs continuously left to right; `corners` from the solver. Empty result → empty array (callers must not send an empty layout).

## Simulator page — `simulator.html` (separate Vite entry; the phone app bundle is unchanged)
- Files: `simulator.html`, `src/sim/main.tsx`, `src/sim/SimApp.tsx` (controls + layout state), `src/sim/scene.ts` (three.js scene, no React), `src/sim/projective-material.ts`.
- **New dependency: `three`** (imported only by the simulator entry). `vite.config.ts` gets `build.rollupOptions.input = { main: 'index.html', simulator: 'simulator.html' }` so both pages build. Lyndz's `sim.html` is left untouched.
- **Scene:** floor grid, the box (using `boxFaces`-consistent geometry: a `BoxGeometry` of the same width/height/depth, lifted by height/2, rotated by yaw), the projector as a small marker plus the frustum drawn as lines (from `projectorCamera`), orbit controls (`three/addons/controls/OrbitControls.js`) for the viewer, resize handling, `dispose()`.
- **Projective material:** a `ShaderMaterial` taking `uProjViewProj` (`Matrix4` from `toColumnMajor(projectorCamera.viewProj)`), `uTex` (the projector image), and `uEye`. Fragment: transform the world position by `uProjViewProj`; if `w <= 0` or the point is outside the image or the surface faces away from the projector → dark; else sample `uTex` at `(ndc.xy * 0.5 + 0.5)` (the texture is a `CanvasTexture`, `flipY` = true, so NDC +Y is the top of the image). Because the box is convex there is no self-shadowing.
- **Projector image = the app's real output:** the simulator behaves like an Output window. A shared hook `useOutputFeed` (see below) listens on the existing channel, plays the received video and applies the received face list to a renderer drawing into a hidden `1280 × round(1280 / aspect)` canvas. That renderer is forced to WebGL2 with `preserveDrawingBuffer: true` so three can sample the canvas at any time. The `CanvasTexture` is marked `needsUpdate` every frame.
- **Layout source:** `mode: 'app' | 'solved'`. In `'app'` the simulator renders the faces it last received from the Editor. **Solve** computes `toSurfaces(solveFaces(box, projector))` and switches to `'solved'`: the simulator renders that layout locally (incoming `surfaces` messages are ignored while in `'solved'`), so you see the video wrapped on the box before touching the app. **Send to app** posts `{ type: 'layout', surfaces }` to the Editor and switches back to `'app'` (the Editor's echo confirms it). Controls changed in `'solved'` mode re-solve live.
- **Controls (React + Tailwind):** box width/height/depth/yaw; projector distance/azimuth/height/throw ratio/aspect/lens shift; Solve; Send to app; a status line listing used faces and any `skipped` with the reason; sensible defaults (box 1 × 1 × 1 m, projector 3 m away, 25° azimuth, 1.5 m high, throw 1.2, aspect 16:9, shift 0). Ranges are clamped; invalid numbers are ignored.

## Changes to the existing app
- `src/output/protocol.ts`: new `Msg` variant `{ type: 'layout'; surfaces: Surface[] }` (simulator → Editor), parsed with exactly the same strict validation as `surfaces` (share the surface-list parser; do not duplicate it).
- `src/ui/Editor.tsx`: on a valid `layout` message, replace the face list (`publish(list)`, select the first face, bump, repaint pins). Ignored if invalid (parseMsg returns null). No confirmation prompt; the simulator's button label says it replaces the app's faces.
- `src/renderer/index.ts` + `webgl2.ts`: `createRenderer(canvas, forced?, options?: { preserveDrawingBuffer?: boolean })`; the option is passed to the WebGL2 context only (WebGPU ignores it). Default behaviour is unchanged.
- `src/ui/useOutputFeed.ts` (new) extracted from `Output.tsx`: the channel creation, `hello`, `surfaces`/`video` handling, the late-load guard and cleanup, parameterised by a `Renderer` and a way to hand out the current `VideoHandle`. `Output.tsx` is refactored to use it with **no behaviour change**.

## Edge cases (each tested where the logic is pure)
1. Projector inside the box or behind it: faces behind the lens are skipped, never produce NaN pins.
2. Projector looking along a face normal (front-on): only that face is front-facing; 1 face returned.
3. From a corner view: 3 faces returned, sorted left to right, strips thirds.
4. Very wide throw (tiny throw ratio): faces partly outside `[0,1]` are kept with `partlyOutside`; faces beyond the `[-0.5, 1.5]` clamp are skipped with reason `off-image`.
5. Box yaw 360° / negative / NaN inputs: the UI clamps; the maths treats non-finite input as the default.
6. Every returned quad passes `isValidQuad` (a projected planar convex face is convex).
7. `toSurfaces` of an empty result is `[]`; the UI disables Send to app.
8. Lens shift `s`: an axis point lands at `v = 0.5 + s`.
9. Corner order is clockwise `tl, tr, br, bl` for any rotation of the box.
10. A malformed or oversized `layout` message is ignored by the Editor.

## Testing
- Unit (Vitest, Node): `math` (lookAt/perspective/transformPoint/toColumnMajor; axis point at the image centre; shift), `box` (six faces, outward normals, yaw), `solve` (cases 1–9 above, symmetry of a front-on cube, face count from a corner view, matrix consistency: a corner projected by `projectToUnit` equals the manual transform of `toColumnMajor` data), `protocol` (`layout` accept/reject, shares rules with `surfaces`).
- three.js scene, shader and React controls: `tsc`, `npm run build` (both entries), then visual check in the browser.
- Manual end-to-end: open the app and `simulator.html` side by side, load a video in the app, set box and projector in the simulator, Solve (video wraps the box), Send to app (pins fill in on all visible faces).

## Risks and honest limits
- This gives a **starting layout from measurements**, not a perfect one. Tape-measure error, real lens shift, a phone screen that is not 16:9, and box position error mean the pins still need nudging. Camera-based calibration (a later milestone) can refine it.
- Two WebGL contexts (the hidden output canvas and the three.js view) in one page: fine on a laptop; the simulator is a desktop/laptop tool.
- `preserveDrawingBuffer` has a small performance cost, applied only when the simulator asks for it.
- The shader duplicates the projection maths on the GPU; the consistency test guards the matrix convention, the visual check guards the rest.
