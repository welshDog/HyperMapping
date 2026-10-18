# Face Shapes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add triangle and circle faces (alongside quads) that are cut out of a four-pin frame with a smooth edge, selectable from the Editor, saved with setups.

**Architecture:** `Surface` gains `shape: 'quad' | 'triangle' | 'circle'` (missing = quad). The mesh and homography warp are untouched; a shaped face's mesh is drawn slightly larger than its frame (a margin) and each vertex carries its frame coordinate plus the shape id. The fragment shader (WebGL2 and WebGPU) computes a signed distance to the shape from the frame coordinate and turns it into anti-aliased coverage, blended over the black clear colour. Quads keep margin 0 and coverage 1, so their output is unchanged.

**Tech Stack:** React + Tailwind + Vite + TypeScript, WebGL2 and WebGPU (WGSL), vitest (`npm test`, `npx tsc --noEmit`).

**Spec:** `docs/superpowers/specs/2026-10-18-face-shapes-design.md`

## Global Constraints

- Max faces stays `MAX_SURFACES = 6`. Faces stay four-pin frames; Glue, Setups, slices unchanged in behaviour.
- Triangle: apex at the middle of the frame's top edge, base along the bottom edge. Circle: the ellipse inscribed in the frame. No other shapes.
- A missing `shape` means `'quad'` everywhere (old setups, autosave, imported files, channel messages). An unknown `shape` value makes the whole face list invalid (strict parser, `src/surfaces/parse.ts`).
- Edge must be anti-aliased (no jagged edges) and the four handles must be as easy to grab on a circle or triangle as on a quad, on a phone (the existing 28 px handle radius stays).
- Quad rendering must be pixel-identical to today (margin 0, coverage 1, same mesh).
- Canvas has no alpha and clears to opaque black; the area outside a shape stays that black. Overlapping shapes draw in list order, no blending between faces beyond the edge.
- Sim (`src/sim`): box faces and `toSurfaces` stay quads. Solve/Send replaces the whole face list as today. Do not add shape editing to the simulator.
- Per-face content (different sources per shape) is a separate later project. Build nothing toward it.
- 8 GB machine: do not start the dev server unprompted; use `npm run build && npm run preview` if a browser is needed. Stage only your own files (`git add <paths>`, never `git add .`; `sim.html` in the repo root stays untracked).
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## Review Focus

- An old saved setup / autosave / export with no `shape` loads as all quads (parse test, Task 1).
- An imported file or channel message with an unknown or non-string `shape` is rejected whole, never half-loaded (Task 1).
- Changing an existing face's shape keeps its id, pins and slice, and the GPU buffers are re-uploaded even though the corners did not change (stale margin bug) (Tasks 1 and 3).
- A shaped face with an invalid (non-convex) frame keeps its previous mesh, and a brand-new one falls back to the full-canvas frame, with no NaN and no crash (Task 3).
- A very small or edge-on shaped face (derivatives near zero) does not vanish or produce NaN coverage (Task 2 maths guard, Task 4/5 shader guard).

---

### Task 1: Face model, parser and add/change-shape

**Files:**
- Modify: `src/surfaces/types.ts`, `src/surfaces/model.ts`, `src/surfaces/parse.ts`
- Test: `src/surfaces/model.test.ts`, `src/surfaces/parse.test.ts`

**Interfaces:**
- Produces (types.ts): `export type FaceShape = 'quad' | 'triangle' | 'circle'`; `export const FACE_SHAPES: readonly FaceShape[]`; `Surface` gains `shape?: FaceShape`; `export const shapeOf = (s: Surface): FaceShape` (returns `s.shape ?? 'quad'`).
- Produces (model.ts): `addSurface(list: Surface[], shape?: FaceShape): Surface[]` (new face gets `shape`, default `'quad'`); `setSurfaceShape(list: Surface[], id: string, shape: FaceShape): Surface[]` (returns the same array reference if the id is unknown or the shape is already that shape; otherwise a new array where only that face changed).
- Produces (parse.ts): `parseSurface` accepts an optional `shape`, validates it against `FACE_SHAPES`, and writes it on the result only when it is not `'quad'` (so quad faces round-trip without a `shape` key).

- [ ] **Step 1: Write failing tests**
  - model.test.ts: `addSurface(list, 'circle')` appends a face with `shape: 'circle'` and the same default corners/slice a quad would get; `addSurface(list)` adds a face with no `shape` key; `setSurfaceShape` keeps `id`, `corners` and `srcRect` identical and changes only `shape`; `setSurfaceShape(list, 'nope', 'circle')` returns `list` itself; same-shape call returns `list` itself; `shapeOf({...})` is `'quad'` when missing.
  - parse.test.ts: a list with no `shape` parses (all quads); `shape: 'triangle'` and `'circle'` survive a parse; `shape: 'hexagon'`, `shape: 3`, `shape: null` each make `parseSurfaceList` return `null`; a parsed quad has no own `shape` key.
- [ ] **Step 2: Run to verify they fail:** `npx vitest run src/surfaces/model.test.ts src/surfaces/parse.test.ts` expects FAIL (missing exports / unknown shape accepted).
- [ ] **Step 3: Implement** the types, `shapeOf`, `addSurface(list, shape)`, `setSurfaceShape`, and the parser change exactly as the Interfaces block says. `isValidSurfaces` also rejects a face whose `shape` is present but not in `FACE_SHAPES`.
- [ ] **Step 4: Run to verify they pass:** same command, expects PASS. Then `npx tsc --noEmit` expects no errors.
- [ ] **Step 5: Commit**
```bash
git add src/surfaces/types.ts src/surfaces/model.ts src/surfaces/parse.ts src/surfaces/model.test.ts src/surfaces/parse.test.ts
git commit -m "feat(surfaces): face shape field, strict parse, add/change shape"
```

---

### Task 2: Shape maths and margin mesh (pure, tested)

**Files:**
- Create: `src/warp/shape.ts`
- Modify: `src/warp/mesh.ts`
- Test: `src/warp/shape.test.ts`, `src/warp/mesh.test.ts`

**Interfaces:**
- Consumes: `FaceShape` from `../surfaces/types`.
- Produces (shape.ts): `export const SHAPE_MARGIN = 0.02` (frame units added on each side of a shaped face's mesh); `export const shapeId = (s: FaceShape): 0 | 1 | 2` (quad 0, triangle 1, circle 2; the shaders use these numbers); `export const meshMargin = (s: FaceShape): number` (0 for quad, `SHAPE_MARGIN` otherwise); `export function shapeDistance(shape: FaceShape, fx: number, fy: number): number` - a signed distance in frame units, negative inside, zero on the edge, positive outside; for `'quad'` it returns `-1` (always inside). This is the reference the shaders mirror.
- Produces (mesh.ts): `warpedPositions(corners, cols, rows, out?, margin = 0)` samples the unit frame from `-margin` to `1 + margin` on both axes (default 0 = today's output exactly); `frameCoords(cols, rows, margin, shape, out?)` returns a `Float32Array` of `(cols+1)*(rows+1)*3` floats `[fx, fy, shapeId]` per vertex on the same extended grid; `scaleUvs(base, rect, out?)` is unchanged but `buildTopology(cols, rows, margin = 0)` builds `uvs` over `-margin..1+margin` so the video slice extrapolates linearly into the margin (the sampler clamps at the video edge).

- [ ] **Step 1: Write failing tests**
  - shape.test.ts: circle `shapeDistance('circle', .5, .5)` is `-0.5`; `(1, .5)` is `0` (within 1e-9); `(1, 1)` is `> 0`. Triangle: `(.5, 0)` is `0` (apex), `(.5, 1)` is `0` (base middle), `(.5, .5)` is `< 0`, `(0, 0)` and `(1, 0)` are `> 0` (empty top corners), `(.5, 1.1)` is `> 0`, and `(0, 1)` and `(1, 1)` are `0` (base ends). `shapeDistance('quad', 9, 9)` is `-1`. `meshMargin('quad') === 0`, `meshMargin('circle') === SHAPE_MARGIN`.
  - mesh.test.ts: `warpedPositions(corners, 20, 20, undefined, 0)` equals the current output for the same corners (existing tests keep passing); with `margin = 0.02` the first vertex equals the homography of `(-0.02, -0.02)` and the vertex count is unchanged; `frameCoords(20, 20, 0.02, 'circle')` has length `441*3`, first triple `[-0.02, -0.02, 2]`, last `[1.02, 1.02, 2]`.
- [ ] **Step 2: Run to verify they fail:** `npx vitest run src/warp/shape.test.ts src/warp/mesh.test.ts` expects FAIL.
- [ ] **Step 3: Implement** per the Interfaces block. Triangle edges as half-planes: left through (0.5,0)-(0,1), right through (0.5,0)-(1,1), base `y = 1`; each divided by its normal length so values are true distances in frame units; the triangle distance is the max of the three. Circle is `hypot(fx-.5, fy-.5) - .5`. Document in a comment that GLSL and WGSL copies must mirror `shapeDistance`.
- [ ] **Step 4: Run to verify they pass:** same command, expects PASS; `npx vitest run src/warp` expects all existing mesh tests still PASS.
- [ ] **Step 5: Commit** (`git add src/warp/shape.ts src/warp/shape.test.ts src/warp/mesh.ts src/warp/mesh.test.ts`, message `feat(warp): shape distance maths and margin mesh`).

---

### Task 3: SurfaceSync handles shape (margin mesh + frame buffer)

**Files:**
- Modify: `src/renderer/surface-sync.ts`
- Test: `src/renderer/surface-sync.test.ts`

**Interfaces:**
- Consumes: `shapeOf` (Task 1); `meshMargin`, `shapeId` (Task 2); `warpedPositions(..., margin)`, `frameCoords`, `buildTopology(cols, rows, margin)` (Task 2).
- Produces: `SurfaceBuffers` gains `frame: F32` (the `[fx, fy, shapeId]` array, length `vertexCount*3`); `SyncResult` gains `changedFrames: string[]` (faces whose frame buffer must be (re)uploaded; always includes every id in `created`). A face whose shape changes (even with identical corners and slice) appears in `changedPositions`, `changedUvs` and `changedFrames`. A shaped face's positions and UVs use its margin; a quad's are exactly as before.

- [ ] **Step 1: Write failing tests** (extend the existing file's style)
  - a new circle face is in `created`, `changedPositions`, `changedUvs` and `changedFrames`, and its `frame` buffer's first triple is `[-0.02, -0.02, 2]`; a new quad face's first triple is `[0, 0, 0]`;
  - re-syncing the same list changes nothing (all four changed lists empty);
  - the same corners and slice with `shape` quad -> circle puts the id in all three changed lists and the positions differ from before;
  - a shaped face with a non-convex frame on re-sync keeps its previous positions (not in `changedPositions`); a brand-new shaped face with a non-convex frame falls back to the full-canvas frame and its buffers contain no `NaN`;
  - removed faces are in `removed`, as before.
- [ ] **Step 2: Run to verify they fail:** `npx vitest run src/renderer/surface-sync.test.ts` expects FAIL.
- [ ] **Step 3: Implement.** `Entry` also stores `wantShape: FaceShape`. Per-margin base UVs: keep one base-UV array per distinct margin (0 and `SHAPE_MARGIN`) built with `buildTopology`; choose by the face's margin when calling `scaleUvs`. On a shape change recompute positions, UVs and frame for that face.
- [ ] **Step 4: Run to verify they pass:** same command PASS, then `npx vitest run src/renderer` PASS and `npx tsc --noEmit` clean (it will flag the two backends if they destructure `SyncResult` strictly; they are updated in Tasks 4-5, so if tsc fails only there, proceed).
- [ ] **Step 5: Commit** (`feat(renderer): surface sync carries shape, margin mesh and frame buffer`).

---

### Task 4: WebGL2 shape shader and edge blending

**Files:**
- Modify: `src/renderer/webgl2.ts`

**Interfaces:**
- Consumes: `SyncResult.changedFrames`, `SurfaceBuffers.frame` (Task 3).
- Produces: a third vertex attribute `a_frame` (`vec3`) per face (its own buffer in `GlSurface`, uploaded on `changedFrames`, freed with the face); fragment output is premultiplied `vec4(rgb * cov, cov)` with `gl.enable(gl.BLEND)` and `gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA)`.

- [ ] **Step 1: Implement the shader.** Vertex shader passes `a_frame` to `v_frame`. Fragment shader mirrors `shapeDistance` from `src/warp/shape.ts` using `int(v_frame.z + 0.5)` to pick the shape without branching on derivatives: compute `f`, then `float w = max(length(vec2(dFdx(f), dFdy(f))), 1e-6); float cov = shape == 0 ? 1.0 : clamp(0.5 - f / w, 0.0, 1.0);`. Output `vec4(texture(u_tex, v_uv).rgb * cov, cov)`. Quad coverage is exactly 1.0 so quad pixels are unchanged. Compute derivatives before any branch on `shape`.
- [ ] **Step 2: Wire buffers.** Create/delete the frame buffer in `createSurface`/`freeSurface`, enable attribute `a_frame` with 3 floats, upload `b.frame` for ids in `r.changedFrames`, size `vertexCount*3*4` bytes.
- [ ] **Step 3: Verify build and tests:** `npx tsc --noEmit` clean (webgl2 only; webgpu may still error until Task 5, in which case continue) and `npx vitest run` shows no new failures.
- [ ] **Step 4: Commit** (`git add src/renderer/webgl2.ts`, message `feat(webgl2): shape mask with anti-aliased edge`).

---

### Task 5: WebGPU shape shader and edge blending

**Files:**
- Modify: `src/renderer/webgpu.ts`

**Interfaces:**
- Consumes: same as Task 4.
- Produces: vertex buffer slot 2 (`float32x3`, `arrayStride: 12`, `shaderLocation: 2`) per face in `GpuSurface` (`frameBuf`, created, written on `changedFrames`, destroyed with the face); pipeline target `blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } }`.

- [ ] **Step 1: Implement the WGSL.** Add `@location(2) frame: vec3f` to `vs` and `VSOut`. In `fs`, compute `f` with the same formulas as `shapeDistance`, `let w = max(length(vec2f(dpdx(f), dpdy(f))), 1e-6);` computed before any branch (use `select`, not `if`, so derivatives stay in uniform control flow), `cov = select(clamp(0.5 - f / w, 0.0, 1.0), 1.0, shape == 0)`, return `vec4f(rgb * cov, cov)` from `textureSampleBaseClampToEdge`.
- [ ] **Step 2: Wire buffers** (`setVertexBuffer(2, g.frameBuf)` in the draw loop, upload for `r.changedFrames`).
- [ ] **Step 3: Verify:** `npx tsc --noEmit` clean for the whole project; `npx vitest run` all PASS.
- [ ] **Step 4: Commit** (`feat(webgpu): shape mask with anti-aliased edge`).

---

### Task 6: Editor controls, outlines and slice preview

**Files:**
- Modify: `src/ui/SurfaceBar.tsx`, `src/ui/Editor.tsx`, `src/ui/PinOverlay.tsx`, `src/ui/SliceEditor.tsx`
- Create: `src/surfaces/outline.ts`
- Test: `src/surfaces/outline.test.ts`

**Interfaces:**
- Consumes: `FaceShape`, `shapeOf` (Task 1); `addSurface(list, shape)`, `setSurfaceShape` (Task 1).
- Produces (outline.ts): `export function shapeOutlinePoints(shape: FaceShape, corners: Corners, segments = 48): Vec2[]` - the shape's edge as points in unit canvas space, found by mapping frame points through the quad's homography (`computeHomography`/`applyHomography` from `src/warp`); quad returns the four corners in order tl, tr, br, bl; triangle returns apex, base-right, base-left mapped; circle returns `segments` points around the inscribed ellipse. Returns `[]` if the quad has no valid homography.
- SurfaceBar props: `onAdd: (shape: FaceShape) => void`, `onSetShape: (shape: FaceShape) => void`, plus `selectedShape: FaceShape`.

- [ ] **Step 1: Write failing tests (outline.test.ts)** with the unit-square `UNIT_CORNERS` as corners: triangle returns 3 points `[.5,0] [1,1] [0,1]` (within 1e-9); circle with `segments = 8` returns 8 points all at distance `0.5` from `(.5,.5)`; quad returns the four corners; a degenerate (all four corners equal) frame returns `[]`.
- [ ] **Step 2: Run to verify they fail:** `npx vitest run src/surfaces/outline.test.ts` expects FAIL.
- [ ] **Step 3: Implement `outline.ts`**, then run again and expect PASS.
- [ ] **Step 4: UI changes** (no UI unit tests; checked in Task 7).
  - SurfaceBar: `+ Face` opens a small three-button choice (Quad / Triangle / Circle, each at least 44 px tall) that calls `onAdd(shape)` and closes; below the tabs, a "Shape" row of the same three buttons highlights `selectedShape` and calls `onSetShape`. Face tab labels stay `Face N`.
  - Editor: `addFace(shape)` uses `addSurface(surfacesRef.current, shape)`; `setShape(shape)` uses `setSurfaceShape`, then `publish(next)` and `bump()`. Pass `selectedShape` from the selected face.
  - PinOverlay: keep the frame polygon (the four-handle quad) but dashed and fainter for non-quad faces, and draw an additional solid `<polygon>` of `shapeOutlinePoints` for each face (selected: filled with the face colour at the existing `22` alpha; others: dashed, existing opacity). Repaint it in `paint()` with the same direct-attribute mutation as the other outlines (a pointermove must still cause no React render). Handle radii and hit areas do not change.
  - SliceEditor: draw the selected face's shape outline (unit frame `shapeOutlinePoints(shape, UNIT_CORNERS)`) inside the slice rectangle as an SVG overlay so the user sees which part of the slice shows.
- [ ] **Step 5: Verify:** `npx tsc --noEmit` clean; `npx vitest run` all PASS.
- [ ] **Step 6: Commit** (`git add` the five UI files plus the two outline files; message `feat(ui): choose and edit face shapes, shape outlines`).

---

### Task 7: Pass-through checks, live pixel check, docs

**Files:**
- Test: `src/setups/setups.test.ts`, `src/calibrate/corners.test.ts`, `src/sim/solve.test.ts`
- Modify: `README.md`, `docs/` as-built notes (match the existing as-built file for the random-visuals spec)

**Interfaces:** Consumes everything above; produces no new code interfaces.

- [ ] **Step 1: Add pass-through tests.**
  - setups: a setup saved with a circle and a triangle face and exported/imported through the existing functions keeps both `shape` values; a stored setup JSON with no `shape` keys loads as quads; autosave round-trip keeps shapes.
  - calibrate: applying calibration corners to a face whose `shape` is `'circle'` (the `...s` spread at `corners.ts:124`) keeps `shape: 'circle'`.
  - sim: `toSurfaces(result)` returns faces with no `shape` key (quads).
  - Glue: a pin shared by a circle face and a quad face still moves both (add to `glue.test.ts`).
- [ ] **Step 2: Run:** `npx vitest run` expects all PASS; `npm run build` expects success.
- [ ] **Step 3: Live pixel check in headless Chrome** (swiftshader; write the script in the session scratchpad, not the repo; serve with `npm run preview`, do not start the dev server). Load the Editor with three faces: quad, triangle, circle, test pattern on. Screenshot and assert: (a) the pixel at the centre of each face is non-black; (b) the pixel just outside the circle's edge and in the triangle's empty top corner is black (0,0,0); (c) zoom the screenshot on the circle edge and the triangle's base: no stair-stepped single-pixel jaggies (edge pixels have intermediate brightness, i.e. at least one pixel along the edge is neither black nor full pattern colour); (d) the quad face is unchanged against a screenshot taken with the old build (`git stash` is not needed; compare against `dist` from before Task 3 if kept, otherwise compare to a pure quad layout). Repeat once with `?renderer=webgl2` style forcing if the app has that switch, else note which backend ran.
- [ ] **Step 4: Ask Lyndz to check on the real phone** (not automatable): add a circle and a triangle, drag the four handles, confirm handles are easy to grab and the edge looks smooth. Record the result in the as-built note.
- [ ] **Step 5: Docs.** README feature list and layout mention shapes; as-built note records: frame + margin approach, `SHAPE_MARGIN = 0.02`, the shader/`shapeDistance` mirror rule, that sim/Solve stays quads and Send replaces a shaped collage, and that per-face content is the next project.
- [ ] **Step 6: Commit** (`test+docs: shape pass-through checks, pixel check notes`).
