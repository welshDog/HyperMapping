# Face shapes: triangle and circle faces

Date: 2026-10-18. Status: draft for approval.

## Intent and the why

Lyndz wants to build a collage of flat shapes (triangles and circles, mixed with the existing
quads) on a wall and project onto it. Today every face is a four-pin quad showing a rectangular
slice of the one shared picture, so a triangle or a disc on the wall cannot be covered without
spilling light past its edge.

Success: Lyndz can add a triangle or a circle from the same **+ Face** control, drag four corner
handles around it to match the real shape on the wall, and see the picture appear only inside
the shape, with a clean edge.

## Decisions made with Lyndz

- Shapes are for **flat walls**. No 3D shape work.
- Every face stays a **four-pin frame** (the existing quad warp, so wall perspective is
  handled correctly). The shape is cut out of the frame:
  - **Quad**: today's behaviour, unchanged.
  - **Circle**: the ellipse inscribed in the frame. Four corner handles around it. It becomes
    an ellipse under perspective, which the warp already produces.
  - **Triangle**: apex at the middle of the frame's top edge, base along the bottom edge
    (a "centred-point" triangle: equilateral, tall or flat isosceles). Lopsided and
    right-angled triangles are explicitly not needed.
- Shapes live in the **same face list** as quads: they use Glue, Setups (save/load/autosave),
  slices, the simulator and the Output window like any face.
- Slices stay as they are: each shape shows a rectangular slice of the one shared video,
  clipped to the shape.
- **Anti-goals (would make this a failure even if it technically works):**
  - Jagged edges. The shape edge must be anti-aliased.
  - Handles that are hard to grab. The four handles must be as easy to grab on a circle or
    triangle as on a quad, on a phone.
- Out of scope here (separate project, agreed order: shapes first, then per-face content):
  each shape showing different content (test pattern on one, a visual look on another).
  Do nothing now that makes that harder; do not build it.

## Constraints from the existing code

- `Surface` is `{ id, corners, srcRect }` (src/surfaces/types.ts). Add a `shape` field:
  `'quad' | 'triangle' | 'circle'`. Missing means `'quad'`, so old saved setups and old
  channel messages still load.
- Rendering is a warped mesh per face (src/warp/mesh.ts, `GRID`), drawn by both
  `webgl2.ts` and `webgpu.ts` with a plain texture-sample fragment shader. The canvas has no
  alpha, so the area outside a shape must stay the cleared black.
- All face lists from outside (channel, stored setup, imported file) go through the one strict
  parser `parseSurface` in src/surfaces/parse.ts. It must accept and validate `shape`, and
  reject unknown values.
- Max faces stays 6. Glue is derived from pin coordinates, so it works unchanged on any shape.
- 8 GB machine: no heavy new per-frame cost.

## Behaviour

- **+ Face** offers Quad, Triangle, Circle (the how is the builder's choice, e.g. a small
  menu; it must work by thumb on a phone).
- A new triangle or circle appears at the same default position/size a quad would get.
- The Editor outlines the shape (not just the frame) and still shows the four handles at
  the frame corners, plus a faint frame outline so the user sees what they are dragging.
- Changing an existing face's shape (quad to circle etc.) keeps its pins and slice.
- The shape clip is applied everywhere faces are drawn: Editor preview, Output window,
  simulator. It must look the same in all of them.
- Edge: anti-aliased over about one output pixel, so it is smooth at any size and on the
  phone.
- Degenerate frames (existing validity rules for a quad) behave as today: the face keeps its
  previous mesh.

## Calibration and simulator

- Camera calibration: treats a shape as its four frame corners (the user taps the four frame
  corners as for a quad). No change expected beyond not breaking.
- Simulator Solve/Send: sends frames; carries `shape` through unchanged (it must not drop it
  when it posts a layout).

## Left to the builder

- Exact way of cutting the shape out (fragment-shader mask from a unit-frame coordinate vs
  stencil/geometry), as long as the edge is smooth and the cost is small. Note the mesh is
  warped by a homography, so the mask coordinate must be perspective-correct.
- UI for choosing a shape, handle sizes and hit-area details, outline styling.
- Test approach. Pure logic (parser, model, defaults) tested as the repo does. Rendering
  needs a live/pixel check in a browser, as past work learned ("always live-check").

## Not decided / my calls (flag for Lyndz)

- Simulator: its 3D box faces stay rectangular and Solve always makes quads. The simulator only
  needs to show the shape cut-out in the projector image it already gets from the shared
  renderer. No shape editing or shape geometry in the 3D box. As today, Send replaces the whole
  face list (so sending from the simulator replaces a shaped collage); the parser and channel
  message still accept `shape`. (My call.)
- Alignment is done with the four frame-corner handles, as Lyndz chose. For a triangle the
  top two corners are empty air; the faint frame outline shows what is being dragged. (Decided.)
- The slice maps to the whole frame; the shape just hides part of it. The slice editor's
  preview should show the shape outline over the slice. (My call.)
- Edge smoothness is measured in pixels of the canvas being drawn to, so each window (Editor,
  Output, simulator) gets a smooth edge at its own resolution. (My call.)

- The shape is part of the saved face, so Setups, Export/Import and autosave carry it. (My call.)
- Overlapping shapes just draw in list order; no blending between them. (My call.)
