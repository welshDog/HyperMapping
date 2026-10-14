# HyperMapping — Glued corners Design Spec

Builds on the multi-face Editor, the virtual projector and save/load. See `2026-10-14-multi-surface-design.md`, `2026-10-14-virtual-projector-design.md` and `2026-10-14-save-load-design.md`.

## Context
A box has corners shared by up to three faces. Today every face's four pins move independently, so after Solve (which puts shared corners on exactly the same spot) a single nudge of one corner leaves the neighbouring faces behind and the seam opens. Lyndz wants pins that sit on the same spot to move together.

Agreed with Lyndz: **magnet snapping plus a Glue on/off switch**. Out of scope: gluing whole edges at once, locking a pin so it never moves, saving the Glue switch with setups.

## The rule (derived, nothing new is stored)
Two pins on different faces are **glued** when they sit on the same spot: both coordinates equal within `GLUE_EPS = 1e-6` (unit space). Glue is therefore derived from the face list, which means it already works with saved setups, auto-restore, the `layout` channel message, the simulator's Solve output (shared box corners are computed from the same 3D point, so they match to the last bit) and JSON round trips (exact doubles).

## Behaviour while dragging a pin (Glue ON, the default)
- Every pin glued to the dragged one moves with it, on any face (a box corner shared by three faces moves all three).
- **Magnet:** when the dragged group comes within `SNAP_RADIUS_PX = 24` screen pixels of a pin on a *different, unglued* face, it snaps exactly onto that pin. Within a drag the snap holds while the pointer stays inside the radius and releases when it leaves (each move of a drag is computed from the layout at drag start, so merely passing a pin never drags it along). Letting go while snapped leaves the pins glued, so the NEXT drag carries both.
- **All or nothing:** if the move would leave ANY affected face with an invalid quad (bow-tie, sliver, collapsed), the whole move is refused and nothing changes (pins are never pulled apart).
- Faces not touched by the move keep their object identity (cheap diffing downstream).

## Behaviour with Glue OFF
Only the dragged pin moves. No snapping. This is how to break a glue: switch Glue off, drag the pin away, switch it back on. (A pin that you leave exactly on another stays glued, by the rule above.)

## Pure module — `src/surfaces/glue.ts` (no DOM; fully unit-tested)
- `type CornerKey = 'tl' | 'tr' | 'br' | 'bl'`; `interface PinRef { surfaceId: string; corner: CornerKey }`.
- `GLUE_EPS = 1e-6`; `SNAP_RADIUS_PX = 24`.
- `gluedGroup(surfaces, ref, eps = GLUE_EPS): PinRef[]` — all pins (any face) at the same spot as `ref`, including `ref`; `[]` if `ref` is unknown. Order: face order, then `tl, tr, br, bl`.
- `snapTarget(surfaces, ref, p, radiusPx, size): Vec2 | null` — the nearest corner, among faces other than `ref`'s own face and excluding the glued group of `ref`, within `radiusPx` measured in pixels (`dx * size.w`, `dy * size.h`, so a non-square canvas is not distorted); returns a copy of that corner's position; null if none, if `size` is not finite and positive, or if `p` is not finite.
- `movePins(surfaces, pins, to): Surface[] | null` — immutable move of every pin in `pins` to `to`; null if `to` is not finite, `pins` is empty or unknown, or ANY affected face fails `isValidQuad`. Unaffected faces are returned as the same objects.
- `moveGluedPin(surfaces, ref, p, opts: { glue: boolean; radiusPx: number; size: { w: number; h: number } }): Surface[] | null` — the single entry point used by the Editor: Glue off → `movePins(surfaces, [ref], p)`; Glue on → `group = gluedGroup(ref)`, `to = snapTarget(...) ?? p`, `movePins(surfaces, group, to)`.

## Editor — `src/ui/`
- `Editor.tsx`: state `glue` (default `true`, not saved). A toolbar toggle button "Glue: on" / "Glue: off" (`aria-pressed`; a SINGLE `bg-*` colour class per state, e.g. `bg-cyan-500 text-black` vs `bg-zinc-700`, because two `bg-*` classes on one element make the later CSS rule win). A new handler `onPinMove(ref, p, size)` calls `moveGluedPin(surfacesRef.current, ref, p, { glue, radiusPx: SNAP_RADIUS_PX, size })`; on a non-null result it calls `publish(next)` and returns true, else false. `onCornersChange` stays for Reset corners.
- `PinOverlay.tsx`: the `onChange(surfaceId, corners)` prop is replaced by `onPinMove(ref, p, size) => boolean` (the overlay passes the clamped pointer position and the SVG's pixel size). The drag state stays in refs with direct attribute mutation (no React state per pointermove). New drawing, all `pointer-events-none`, updated in `paint()`:
  - a small dim dot at every corner of every NON-selected face (in that face's colour), so the user can see where a pin will snap;
  - a ring around each selected-face pin that is glued to at least one other pin.
- Reset corners, add/delete face, Setups load and the simulator's `layout` adoption are unchanged (they replace corners wholesale, which breaks or rebuilds glue by the rule above).

## Edge cases (each tested where pure)
1. A box corner shared by three faces: the group has 3 pins and all three move together.
2. Pins 1e-7 apart are glued; pins 1e-3 apart are not.
3. A group move that makes any face invalid returns null and leaves the input list untouched.
4. The snap radius is in pixels: on a 1000 × 500 canvas a gap of 0.02 in x is 20 px (snaps) and the same gap in y is 10 px; a gap of 0.03 in x is 30 px (does not snap).
5. Snapping ignores the dragged pin's own face and members of its own glued group; with several candidates it picks the nearest.
6. Glue off: only the dragged pin moves even if others are glued to it, and nothing snaps.
7. After a snap, `gluedGroup` of the dragged pin includes the target's pins.
8. Non-finite pointer positions, unknown pin refs and zero-size canvases return null and change nothing.
9. Unaffected faces keep object identity in the returned list.
10. A single face (no partners) behaves exactly as before.
11. A group that contains two pins of the same face (degenerate input) is refused rather than collapsing the face.

## Testing
- Unit (Vitest, Node): every function above against hand-built lists, including a three-face box-corner fixture built from `solveFaces`/`toSurfaces` (real Solve output is glued at the shared corners: assert it, which also guards the "exact match" assumption the rule rests on).
- Overlay, toggle and drawing: `tsc` + `npm run build`, then a manual check: Solve → Send to app, drag a shared corner (all faces follow), switch Glue off and drag one away, switch on and drag it back (it snaps), try a move that would break a face (refused).

## Risks
- Snapping can surprise: a pin dragged near another snaps and is then carried with it. The Glue switch is the escape, and the dim dots show where snaps will happen.
- Exact-equality glue depends on coordinates surviving untouched. Any operation that rewrites coordinates (Reset corners, a slider-based re-solve) naturally rebuilds or breaks glue; documented, not defended.
- The overlay now draws up to 5 × 4 extra dots; negligible.
