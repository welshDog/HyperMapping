# Face shapes: as built (2026-10-18)

Design: `2026-10-18-face-shapes-design.md`. Plan: `../plans/2026-10-18-hypermapping-face-shapes.md`.

## What was built

- `Surface.shape?: 'quad' | 'triangle' | 'circle'` (missing = quad). The strict parser (`src/surfaces/parse.ts`) accepts it, writes no key for quads, and rejects the whole list for an unknown value, so old setups, autosave and files load unchanged.
- Rendering keeps the homography mesh. A shaped face's mesh is drawn `SHAPE_MARGIN = 0.02` of the frame beyond each side (`src/warp/mesh.ts`, `warpedPositions(..., margin)`, `buildTopology(..., margin)`), so the shape's edge, including a triangle's base and a circle's tangent points, can be anti-aliased instead of sitting on the aliased mesh boundary. Quads keep margin 0 and are pixel-identical to before (live check: 0 intermediate edge pixels).
- Each vertex carries `[frameX, frameY, shapeId]` (`frameCoords`); `SurfaceSync` owns a per-face frame buffer (`changedFrames` in `SyncResult`) and re-uploads positions, UVs and frame when only the shape changes. A frame with no valid warp freezes the whole face.
- The fragment shaders (GLSL in `webgl2.ts`, WGSL in `webgpu.ts`) compute a signed distance, turn it into a ~1 pixel coverage with the screen-space derivative, and output premultiplied colour with `ONE, ONE_MINUS_SRC_ALPHA` blending over the black clear. `shapeDistance()` in `src/warp/shape.ts` is the tested reference: change all three together.
- UI: `+ Face` asks Quad / Triangle / Circle, a Shape row changes the selected face, `PinOverlay` draws the dashed frame plus the solid shape outline (`src/surfaces/outline.ts`), `SliceEditor` outlines the shape on the slice. Handle sizes unchanged (28 px radius).
- Simulator unchanged: Solve makes quads, Send replaces the whole list.

## Checks

- 575+ vitest tests. Pass-through tests: setups (export/import, autosave, old files), calibration `applyCalibration`, `toSurfaces`, glue across shapes.
- Headless Chrome (swiftshader, WebGL2) pixel check with a solid-colour source on a quad, triangle and circle: centres filled, empty frame corners black, quad edges untouched, ~740 and ~680 anti-aliased pixels along the triangle and circle edges.
- NOT checked: the WebGPU shader live (headless has no WebGPU adapter; a shader compile failure falls back to WebGL2 automatically, a visual mismatch would not), and a real phone (handle grabbing, edge look).

## Next

Per-face content (a different source per face) is the next project and needs its own design.
