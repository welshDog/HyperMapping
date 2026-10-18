# Face shapes: as built (2026-10-18)

Design: `2026-10-18-face-shapes-design.md`. Plan: `../plans/2026-10-18-hypermapping-face-shapes.md`.

## What was built

- `Surface.shape?: 'quad' | 'triangle' | 'circle'` (missing = quad). The strict parser (`src/surfaces/parse.ts`) accepts it, writes no key for quads, and rejects the whole list for an unknown value, so old setups, autosave and files load unchanged.
- Rendering keeps the homography mesh. The mesh is the inner 21x21 grid a quad always had plus ONE outer ring of vertices at `-SHAPE_MARGIN` and `1 + SHAPE_MARGIN` (`SHAPE_MARGIN = 0.02`; `src/warp/mesh.ts`, `gridLines`, `warpedPositions(..., margin)`, `buildTopology(..., margin)`: 23x23 vertices for every face), so the shape's edge, including a triangle's base and a circle's tangent points, can be anti-aliased instead of sitting on the aliased mesh boundary. For a quad the ring collapses onto the frame edge (zero-area cells draw nothing), so quads keep their old pixels (live check: 0 intermediate edge pixels). The first version stretched the whole grid by the margin; the final review showed that spilled light up to 70+ px past a triangle on a strongly foreshortened frame (shape edge inside cells whose colour is interpolated straight in screen space), so the ring keeps the shape's frame edges ON vertices. A CPU-rasteriser test (`src/warp/spill.test.ts`) pins it.
- Each vertex carries `[frameX, frameY, shapeId]` (`frameCoords`); `SurfaceSync` owns a per-face frame buffer (`changedFrames` in `SyncResult`) and re-uploads positions, UVs and frame when only the shape changes. A frame with no valid warp freezes the whole face.
- The fragment shaders (GLSL in `webgl2.ts`, WGSL in `webgpu.ts`) compute a signed distance, turn it into a ~1 pixel coverage with the screen-space derivative, and output premultiplied colour with `ONE, ONE_MINUS_SRC_ALPHA` blending over the black clear. `shapeDistance()` in `src/warp/shape.ts` is the tested reference: change all three together.
- UI: `+ Face` asks Quad / Triangle / Circle, a Shape row changes the selected face, `PinOverlay` draws the dashed frame plus the solid shape outline (`src/surfaces/outline.ts`), `SliceEditor` outlines the shape on the slice. Handle sizes unchanged (28 px radius).
- Known limit: a circle's curved edge falls inside grid cells whose colour is interpolated in a straight line on screen, so on a very foreshortened frame it can spill a few pixels (about 2.6 px at 6:1, 6.6 px at 12:1 on a 640 px canvas; also true at margin 0). Fix would be perspective-correct interpolation (per-vertex w), which also changes quad pixels slightly; deferred. Triangles do not spill.
- On phones whose `mediump` is 16-bit the fragment shader now uses `highp`, so the picture lookup can differ very slightly from before; 'quads pixel-identical' is verified on desktop.
- Simulator unchanged: Solve makes quads, Send replaces the whole list.

## Checks

- 575+ vitest tests. Pass-through tests: setups (export/import, autosave, old files), calibration `applyCalibration`, `toSurfaces`, glue across shapes.
- Headless Chrome (swiftshader, WebGL2) pixel check with a solid-colour source on a quad, triangle and circle: centres filled, empty frame corners black, quad edges untouched, ~740 and ~680 anti-aliased pixels along the triangle and circle edges.
- NOT checked: the WebGPU shader live (headless has no WebGPU adapter; a shader compile failure falls back to WebGL2 automatically, a visual mismatch would not), and a real phone (handle grabbing, edge look).

## Next

Per-face content (a different source per face) is the next project and needs its own design.
