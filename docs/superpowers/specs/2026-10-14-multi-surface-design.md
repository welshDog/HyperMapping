# HyperMapping — Multi-surface (box mapping) Design Spec

Milestone 3 of the main spec (`2026-10-14-hypermapping-design.md`). Builds on M1, which is shipped and phone-tested (single quad, WebGPU/WebGL2, `#output` window, play mode).

## Context
M1 maps one video onto one four-pin quad. To project onto a box you need one quad per visible face (about three from one viewpoint), each warped to its own face, all showing one shared video "unfolded" across them. Lyndz tested M1 on laptop and phone and asked for more mapping grids to cover a box.

Agreed with Lyndz:
- Each grid (face) shows its own **rectangle ("slice") of one shared video**, like unfolding the box. A slice can be dragged and resized.
- Up to **6** surfaces. A new surface gets an even slice, so three faces start as thirds.
- Out of scope: saving/loading setups (M2), gluing neighbouring faces' pins together, a separate video per face.

## Data model — `src/surfaces/`
```ts
export interface SrcRect { u0: number; v0: number; u1: number; v1: number } // video space, 0..1, v down
export interface Surface { id: string; corners: Corners; srcRect: SrcRect }  // corners: unit space, order tl,tr,br,bl
export const MAX_SURFACES = 6;
export const MIN_SLICE = 0.05;
```
Pure functions in `src/surfaces/model.ts` (all unit-tested, no DOM):
- `defaultSlices(n): SrcRect[]` — n equal vertical strips covering the full video height. `defaultSlices(1)` is the full video.
- `defaultCorners(index): Corners` — a quad of about 40% of the canvas, offset in a grid by index so new faces do not sit exactly on top of each other. Must always pass `isValidQuad`.
- `addSurface(list): Surface[]` — returns the list unchanged at `MAX_SURFACES`. Otherwise appends a surface with a unique id. Slices: any existing surface whose `srcRect` equals its **default slice for the old count** is re-sliced to the new count; surfaces the user customised keep their slice; the new surface gets its default slice for the new count.
- `removeSurface(list, id): Surface[]` — never removes the last surface. Returns the list unchanged for an unknown id. Does not re-slice.
- `selectAfterRemove(list, removedId): string` — id to select next (the previous neighbour, else the next).
- `isValidSrcRect(r): boolean` — all finite, within [0,1], `u1-u0 >= MIN_SLICE`, `v1-v0 >= MIN_SLICE`.
- `moveRect(r, du, dv): SrcRect` and `resizeRect(r, corner, u, v): SrcRect` — clamp into [0,1] and enforce `MIN_SLICE`; never return an invalid rect.
- `isValidSurfaces(list): boolean` — length 1..`MAX_SURFACES`, unique string ids (1..32 chars), every `srcRect` valid, every `corners` finite.
- `surfaceColor(index): string` — fixed palette of 6 distinguishable colours, used by the editor only.

## Renderer changes — `src/renderer/`
`Renderer` interface:
- **Replace** `setCorners(corners)` with `setSurfaces(surfaces: Surface[]): void`. Everything else (`setVideo`, `setFpsCap`, `start`, `stop`, `destroy`, `onFrameTime`, `onDeviceLost`) is unchanged.
- Semantics: the renderer keeps a per-surface GPU resource set keyed by `id`. On each call it diffs by id: new ids allocate resources, missing ids free them, existing ids update only what changed (corners → positions, `srcRect` → UVs). A surface whose `corners` fail `isValidQuad` keeps its **previous** mesh (other faces are unaffected). A surface with an invalid `srcRect` keeps its previous UVs.
- Static data is shared by all surfaces: one index buffer (`buildTopology().indices`). Per surface: a position buffer (441 vertices, updated when corners change) and a UV buffer (441 vertices, updated when `srcRect` changes).
- UVs per surface are computed on the CPU by a new pure function `scaleUvs(baseUvs, srcRect, out)` in `src/warp/mesh.ts` (`u = u0 + baseU*(u1-u0)`, same for v). No shader changes and no per-surface uniforms are needed, because the existing UV attribute simply carries slice coordinates.
- Draw: clear to black; if the video is ready, upload/import the video texture **once**, then draw each surface in list order (later surfaces draw over earlier ones where they overlap). With no ready video, draw only the black clear (no surfaces), as today.
- WebGL2: one VAO per surface (own position + UV buffers, shared index buffer). WebGPU: per-surface position + UV buffers, one external-texture bind group per frame shared by all surfaces.
- `destroy()` frees every per-surface resource; adding and removing surfaces repeatedly must not leak buffers (a removed surface's buffers/VAO are destroyed immediately).
- The `destroyed` guards, `onDeviceLost`, and shader cleanup behaviour stay as they are.

## Protocol — `src/output/protocol.ts`
- **Replace** the `state` message with `{ type: 'surfaces'; surfaces: Surface[] }`. `hello` and `video` are unchanged.
- `parseMsg` validates a `surfaces` message with the same strictness as today (finite numbers, rebuilt objects, no extra fields passed through) plus `isValidSurfaces`; invalid messages return `null`.
- The Editor broadcasts `surfaces` on every change (as it did `state`), on channel creation, and in reply to `hello`.

## Editor UI — `src/ui/`
- **State:** `surfacesRef` (all pin drags mutate it; no React state per pointermove) and `selectedId` (React state). A `surfaceVersion` counter in state triggers re-render only when the list shape changes (add/remove/select), not during drags.
- **`SurfaceBar`** (new): a horizontal strip above the toolbar — one tab per face in that face's colour, `+ Face` (disabled at 6), `Delete` (disabled with 1 face), `Edit slice` toggle. Replaces nothing else; the existing toolbar (Load video, Reset corners, Play mode, Open output window) stays.
- **`PinOverlay`**: draws every surface's outline in its colour. Only the **selected** surface's four pins are visible/interactive (larger, bright); other surfaces show a dim outline with no pointer targets, so a drag can never grab a pin on the wrong face. `onChange(surfaceId, nextCorners) => boolean` (true = accepted by `isValidQuad`). Pointer capture, `touch-none`, clamp to [-0.5, 1.5] and NaN handling stay as they are. Pins stay above the toolbar (`z-30`).
- **`SliceEditor`** (new, shown while `Edit slice` is on): a full-screen dark panel with a rectangle at the video's aspect ratio. The selected face's `srcRect` is shown as a draggable/resizable rectangle in its colour (drag body = move, four corner handles = resize); other faces' rects are dim outlines. Uses `moveRect`/`resizeRect` so it can never produce an invalid rect. No video frame preview in this milestone.
- **Reset corners** now resets the **selected** face to `defaultCorners(index)`.
- **Play mode** is unchanged (hides all UI, fullscreen, wake lock); it shows all faces.
- `Output.tsx` applies `surfaces` messages with `renderer.setSurfaces`.

## Edge cases (each needs a test where logic is pure)
1. Bow-tie / sliver on face A: only A freezes at its last valid mesh; B and C keep updating (`setSurfaces` per-surface validity).
2. Delete the selected face: selection moves to the neighbour; deleting the last remaining face is refused.
3. Add at 6: no-op, button disabled; ids stay unique after delete-then-add.
4. Customised slices survive `addSurface`; auto slices re-balance to thirds.
5. `srcRect` dragged to zero/negative size or outside [0,1]: clamped by `resizeRect`; never reaches the renderer invalid.
6. Output window opened late, or Editor reloaded: `hello` reply and the creation broadcast restore all surfaces.
7. A wire message with duplicate ids, >6 surfaces, NaN, wrong types: `parseMsg` returns `null` (Output ignores it).
8. Surfaces overlapping on screen: later surfaces draw on top; documented, not blocked.
9. Zero surfaces never occurs in the Editor (minimum 1); a renderer given an empty list draws only the black clear.

## Testing
- Unit (Vitest, Node): `surfaces/model` (every function above, incl. colour palette length ≥ 6, id uniqueness, default corners valid), `scaleUvs`, protocol `surfaces` validation, slice move/resize clamping.
- Renderer diffing: factor the keyed add/remove/update logic into a pure helper (`diffSurfaces(prevIds, nextSurfaces) → {add, remove, update}`) and unit-test it, since the GPU code itself cannot run in Node.
- GPU code and UI wiring: `tsc`, `npm run build`, then the phone check.
- Phone verification (manual): 3 faces on a real box; drag each face's pins onto its face; change a slice; play mode; open output window; delete a face; reload the Editor with the output window open.

## Risks
- Per-frame cost grows linearly with faces (6 × 2400 indices is trivial); the video texture upload is still once per frame, so heat should not change much.
- Overlapping faces and shared edges are fiddly to align by hand; gluing shared corners is the obvious next follow-up.
- The `Renderer` interface change touches both backends, `useRenderer` callers, and `Editor`/`Output`; the tests for M1 that call `setCorners` (if any) must be migrated.
