# HyperMapping Glued Corners Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pins that sit on the same spot (different faces) move together when dragged, a dragged pin snaps onto a nearby pin of another face, and a Glue on/off switch lets the user break a glue.

**Architecture:** A pure module `src/surfaces/glue.ts` derives "glued" purely from coordinates (no new stored data), finds the glued group of a pin, finds a snap target (distance measured in screen pixels), and moves a whole group all-or-nothing. The pin overlay reports pin moves to the Editor, which calls the pure module and publishes the result through the existing single `publish` path. The overlay also draws dim dots on other faces' corners and rings on glued pins.

**Tech Stack:** React 18, TypeScript 5.9 (strict), Vitest 2 (Node env), Tailwind 3.

**Spec:** `docs/superpowers/specs/2026-10-14-glued-corners-design.md`

## Global Constraints

- Glued = two pins (any faces) with both coordinates equal within `GLUE_EPS = 1e-6` in unit space. Nothing about glue is stored or saved; it is derived from the face list.
- `SNAP_RADIUS_PX = 24`; the snap distance is `hypot(dx * size.w, dy * size.h)` in screen pixels, never in raw unit space.
- Glue ON (default): the dragged pin's whole glued group moves; if within the snap radius of a pin on a face that is NOT involved in the group (not the dragged pin's own face, and not any face that has a pin in the dragged group) the group snaps exactly onto that pin; the move is ALL-OR-NOTHING: if any affected face would fail `isValidQuad`, nothing changes.
- Glue OFF: only the dragged pin moves, nothing snaps.
- Faces not affected by a move keep their object identity.
- Existing behaviour unchanged: Reset corners, add/delete face, slice editor, Setups, the `layout` message and the simulator keep working; a single-face layout behaves exactly as before. Pin drag state stays in refs with direct SVG attribute mutation (no React state per pointermove); pins stay `z-30`.
- A single `bg-*` colour class per element (two `bg-*` classes on one element make the later CSS rule win; zinc beats cyan).
- Every commit passes `npx tsc --noEmit`, `npm test`, `npm run build`; the test count only goes up. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never `git add` anything under `.superpowers/` or the user's untracked `sim.html`.
- Working directory for every command: `h:\HYPERFOCUSZONE\HperCore\HyperMapping`. The machine is short of RAM: do not start a dev server; verify with tsc, vitest and the build only.

## Review Focus

1. **All-or-nothing**: a group move that would break any affected face returns null and changes nothing; a group never ends half-moved. Tested in Task 1.
2. **Glue off isolates a pin**: with Glue off only the dragged pin moves and nothing snaps, even when other pins are glued to it. Tested in Task 1.
3. **Pixel-scale snapping**: the same unit-space gap snaps on one canvas shape and not on another. Tested in Task 1.
4. **Real Solve output is glued**: the shared corners produced by `solveFaces` + `toSurfaces` form exactly one group of 3 and three groups of 2. Tested in Task 1 (this guards the exact-equality assumption the whole feature rests on).
5. **Pointer handling unchanged for the single-face case**; partner faces' outlines, dots and rings repaint during a drag with no React state per pointermove. Read in Task 2's review.

---

## File Structure

```
src/surfaces/glue.ts        pure glue logic (+ glue.test.ts)
src/ui/PinOverlay.tsx       reports pin moves; draws partner dots and glue rings
src/ui/Editor.tsx           glue state + toggle, onPinMove
README.md                   Glue bullet in "Mapping a box"
```

---

### Task 1: The glue module (pure)

**Files:**
- Create: `src/surfaces/glue.ts`
- Test: `src/surfaces/glue.test.ts`

**Interfaces:**
- Consumes: `Surface`, `FULL_RECT` (types), `isValidQuad`, `Corners`, `Vec2`; in tests also `solveFaces`, `toSurfaces`, `DEFAULT_BOX`, `DEFAULT_PROJECTOR`.
- Produces: `type CornerKey`; `CORNER_KEYS`; `interface PinRef { surfaceId: string; corner: CornerKey }`; `GLUE_EPS`; `SNAP_RADIUS_PX`; `gluedGroup(surfaces, ref, eps?) : PinRef[]`; `snapTarget(surfaces, ref, p, radiusPx, size) : Vec2 | null`; `movePins(surfaces, pins, to) : Surface[] | null`; `moveGluedPin(surfaces, ref, p, opts) : Surface[] | null`.

- [ ] **Step 1: Write the failing test**

`src/surfaces/glue.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { DEFAULT_BOX, DEFAULT_PROJECTOR } from '../sim/defaults';
import { solveFaces, toSurfaces } from '../sim/solve';
import type { Corners } from '../warp/types';
import { CORNER_KEYS, GLUE_EPS, SNAP_RADIUS_PX, gluedGroup, moveGluedPin, movePins, snapTarget, type PinRef } from './glue';
import { FULL_RECT, type Surface } from './types';

const sq = (x0: number, y0: number, x1: number, y1: number): Corners => ({
  tl: [x0, y0],
  tr: [x1, y0],
  br: [x1, y1],
  bl: [x0, y1],
});
const face = (id: string, corners: Corners): Surface => ({ id, corners, srcRect: FULL_RECT });
const pin = (surfaceId: string, corner: PinRef['corner']): PinRef => ({ surfaceId, corner });
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

// A and B sit side by side and share the edge x = 0.5 (A.tr == B.tl, A.br == B.bl).
const A = face('a', sq(0.1, 0.2, 0.5, 0.8));
const B = face('b', sq(0.5, 0.2, 0.9, 0.8));
// C is far away from both; its top-left is (0.6, 0.0).
const C = face('c', sq(0.6, 0.0, 0.95, 0.15));
const SIZE = { w: 1000, h: 500 };

describe('constants', () => {
  it('have the agreed values', () => {
    expect(GLUE_EPS).toBe(1e-6);
    expect(SNAP_RADIUS_PX).toBe(24);
    expect(CORNER_KEYS).toEqual(['tl', 'tr', 'br', 'bl']);
  });
});

describe('gluedGroup', () => {
  it('finds the pins on the same spot, in face then corner order, including itself', () => {
    expect(gluedGroup([A, B, C], pin('a', 'tr'))).toEqual([pin('a', 'tr'), pin('b', 'tl')]);
    expect(gluedGroup([A, B, C], pin('b', 'bl'))).toEqual([pin('a', 'br'), pin('b', 'bl')]);
  });
  it('a lone pin is a group of one; an unknown pin is empty', () => {
    expect(gluedGroup([A, B, C], pin('a', 'tl'))).toEqual([pin('a', 'tl')]);
    expect(gluedGroup([A, B, C], pin('nope', 'tl'))).toEqual([]);
  });
  it('is tolerant to 1e-7 but not to 1e-3', () => {
    const near = face('b', { ...B.corners, tl: [0.5 + 1e-7, 0.2] });
    const far = face('b', { ...B.corners, tl: [0.5 + 1e-3, 0.2] });
    expect(gluedGroup([A, near], pin('a', 'tr'))).toHaveLength(2);
    expect(gluedGroup([A, far], pin('a', 'tr'))).toHaveLength(1);
  });
});

describe('movePins', () => {
  it('moves every pin in the group to the same point and leaves other faces as the same objects', () => {
    const out = movePins([A, B, C], [pin('a', 'tr'), pin('b', 'tl')], [0.55, 0.25])!;
    expect(out[0].corners.tr).toEqual([0.55, 0.25]);
    expect(out[1].corners.tl).toEqual([0.55, 0.25]);
    expect(out[0].corners.tl).toEqual(A.corners.tl);
    expect(out[2]).toBe(C);
    expect(A.corners.tr).toEqual([0.5, 0.2]); // the input is not mutated
  });
  it('refuses the whole move when ANY affected face would become invalid, changing nothing', () => {
    const before = clone([A, B, C]);
    // x = 1.2 turns B inside out even though A alone would be fine
    expect(movePins([A, B, C], [pin('a', 'tr'), pin('b', 'tl')], [1.2, 0.2])).toBeNull();
    expect(movePins([A, B, C], [pin('a', 'tr')], [0.1, 0.9])).toBeNull(); // collinear A
    expect([A, B, C]).toEqual(before);
  });
  it('refuses non-finite targets, empty pin lists and unknown pins', () => {
    expect(movePins([A, B], [pin('a', 'tr')], [NaN, 0.2])).toBeNull();
    expect(movePins([A, B], [pin('a', 'tr')], [0.5, Infinity])).toBeNull();
    expect(movePins([A, B], [], [0.5, 0.5])).toBeNull();
    expect(movePins([A, B], [pin('zzz', 'tl')], [0.5, 0.5])).toBeNull();
  });
  it('refuses a group that holds two pins of the same face (it would collapse the face)', () => {
    expect(movePins([A, B], [pin('a', 'tl'), pin('a', 'tr')], [0.3, 0.5])).toBeNull();
  });
});

describe('snapTarget', () => {
  const lone = face('a', sq(0.1, 0.2, 0.4, 0.8)); // not touching C
  const c = face('c', sq(0.6, 0.2, 0.95, 0.5)); // c.tl = (0.6, 0.2)

  it('snaps to a pin of another face within the pixel radius and returns a copy', () => {
    const t = snapTarget([lone, c], pin('a', 'tr'), [0.59, 0.2], 24, SIZE)!; // 10 px away
    expect(t).toEqual([0.6, 0.2]);
    expect(t).not.toBe(c.corners.tl);
  });
  it('does not snap beyond the radius', () => {
    expect(snapTarget([lone, c], pin('a', 'tr'), [0.57, 0.2], 24, SIZE)).toBeNull(); // 30 px
  });
  it('measures the radius in pixels, so the canvas shape matters', () => {
    const p: [number, number] = [0.6, 0.23]; // dy = 0.03
    expect(snapTarget([lone, c], pin('a', 'tr'), p, 24, { w: 1000, h: 500 })).toEqual([0.6, 0.2]); // 15 px
    expect(snapTarget([lone, c], pin('a', 'tr'), p, 24, { w: 1000, h: 1000 })).toBeNull(); // 30 px
  });
  it('ignores the dragged pin\'s own face', () => {
    expect(snapTarget([lone, c], pin('a', 'tr'), [0.1, 0.2], 24, SIZE)).toBeNull(); // right on a.tl
  });
  it('ignores every face that already has a pin in the dragged group', () => {
    // dragging the shared pin of A and B: B's far corner b.tr (0.9, 0.2) must not be a target
    expect(snapTarget([A, B, C], pin('a', 'tr'), [0.9, 0.2], 24, SIZE)).toBeNull();
  });
  it('picks the nearest of several candidates', () => {
    const d = face('d', sq(0.62, 0.2, 0.95, 0.5)); // d.tl = (0.62, 0.2)
    expect(snapTarget([lone, c, d], pin('a', 'tr'), [0.615, 0.2], 24, SIZE)).toEqual([0.62, 0.2]);
    expect(snapTarget([lone, c, d], pin('a', 'tr'), [0.605, 0.2], 24, SIZE)).toEqual([0.6, 0.2]);
  });
  it('returns null for bad input', () => {
    expect(snapTarget([lone, c], pin('a', 'tr'), [NaN, 0.2], 24, SIZE)).toBeNull();
    expect(snapTarget([lone, c], pin('a', 'tr'), [0.6, 0.2], 24, { w: 0, h: 500 })).toBeNull();
    expect(snapTarget([lone, c], pin('a', 'tr'), [0.6, 0.2], 0, SIZE)).toBeNull();
    expect(snapTarget([lone], pin('a', 'tr'), [0.6, 0.2], 24, SIZE)).toBeNull(); // nothing to snap to
  });
});

describe('moveGluedPin', () => {
  const opts = (glue: boolean) => ({ glue, radiusPx: 24, size: SIZE });

  it('Glue on: carries the whole glued group', () => {
    const out = moveGluedPin([A, B, C], pin('a', 'tr'), [0.55, 0.25], opts(true))!;
    expect(out[0].corners.tr).toEqual([0.55, 0.25]);
    expect(out[1].corners.tl).toEqual([0.55, 0.25]);
  });
  it('Glue off: only the dragged pin moves, and nothing snaps', () => {
    const out = moveGluedPin([A, B, C], pin('a', 'tr'), [0.55, 0.25], opts(false))!;
    expect(out[0].corners.tr).toEqual([0.55, 0.25]);
    expect(out[1].corners.tl).toEqual([0.5, 0.2]); // B stayed put: the glue is broken
    const noSnap = moveGluedPin([A, B, C], pin('a', 'tr'), [0.6, 0.01], opts(false))!; // right next to c.tl
    expect(noSnap[0].corners.tr).toEqual([0.6, 0.01]);
  });
  it('Glue on: snaps the whole group onto a nearby pin, after which all of them are glued', () => {
    const out = moveGluedPin([A, B, C], pin('a', 'tr'), [0.6, 0.02], opts(true))!; // 10 px from c.tl (0.6, 0.0)
    expect(out[0].corners.tr).toEqual([0.6, 0.0]);
    expect(out[1].corners.tl).toEqual([0.6, 0.0]);
    expect(out[2].corners.tl).toEqual([0.6, 0.0]);
    expect(gluedGroup(out, pin('a', 'tr'))).toEqual([pin('a', 'tr'), pin('b', 'tl'), pin('c', 'tl')]);
  });
  it('Glue on: a move that would break a partner face is refused and nothing changes', () => {
    const before = clone([A, B, C]);
    expect(moveGluedPin([A, B, C], pin('a', 'tr'), [1.2, 0.2], opts(true))).toBeNull();
    expect([A, B, C]).toEqual(before);
  });
  it('a single face with no partners moves just that pin, as before', () => {
    const out = moveGluedPin([A], pin('a', 'tr'), [0.45, 0.25], opts(true))!;
    expect(out[0].corners.tr).toEqual([0.45, 0.25]);
    expect(out[0].corners.tl).toEqual(A.corners.tl);
  });
  it('returns null for an unknown pin or a non-finite position', () => {
    expect(moveGluedPin([A, B], pin('zzz', 'tl'), [0.5, 0.5], opts(true))).toBeNull();
    expect(moveGluedPin([A, B], pin('a', 'tl'), [NaN, 0.5], opts(true))).toBeNull();
  });
});

describe('real Solve output', () => {
  const layout = toSurfaces(solveFaces(DEFAULT_BOX, DEFAULT_PROJECTOR));

  it('is glued at the shared box corners: one group of three, three groups of two', () => {
    expect(layout).toHaveLength(3);
    const seen = new Set<string>();
    const sizes: number[] = [];
    for (const s of layout) {
      for (const corner of CORNER_KEYS) {
        const key = `${s.id}:${corner}`;
        if (seen.has(key)) continue;
        const group = gluedGroup(layout, { surfaceId: s.id, corner });
        group.forEach((g) => seen.add(`${g.surfaceId}:${g.corner}`));
        sizes.push(group.length);
      }
    }
    expect(sizes.sort()).toEqual([1, 1, 1, 2, 2, 2, 3]);
  });

  it('moving the three-way corner carries all three faces', () => {
    const triple = layout
      .flatMap((s) => CORNER_KEYS.map((corner) => ({ surfaceId: s.id, corner })))
      .find((ref) => gluedGroup(layout, ref).length === 3)!;
    const at = layout.find((s) => s.id === triple.surfaceId)!.corners[triple.corner];
    const to: [number, number] = [at[0] + 0.01, at[1] + 0.01];
    const out = moveGluedPin(layout, triple, to, { glue: true, radiusPx: 0.0001, size: { w: 1000, h: 500 } })!;
    expect(out).not.toBeNull();
    for (const g of gluedGroup(layout, triple)) {
      expect(out.find((s) => s.id === g.surfaceId)!.corners[g.corner]).toEqual(to);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/surfaces/glue.test.ts`
Expected: FAIL — `./glue` not found.

- [ ] **Step 3: Implement**

`src/surfaces/glue.ts`:
```ts
import { isValidQuad } from '../warp/quad';
import type { Corners, Vec2 } from '../warp/types';
import type { Surface } from './types';

export type CornerKey = 'tl' | 'tr' | 'br' | 'bl';
export const CORNER_KEYS: readonly CornerKey[] = ['tl', 'tr', 'br', 'bl'];

/** One pin: which face, which corner. */
export interface PinRef {
  surfaceId: string;
  corner: CornerKey;
}

/** Pins closer than this (unit space, per axis) count as sitting on the same spot, i.e. glued. */
export const GLUE_EPS = 1e-6;
/** A dragged pin snaps to a pin of another face within this many screen pixels. */
export const SNAP_RADIUS_PX = 24;

const same = (a: Vec2, b: Vec2, eps: number) => Math.abs(a[0] - b[0]) <= eps && Math.abs(a[1] - b[1]) <= eps;
const finite2 = (p: Vec2) => Number.isFinite(p[0]) && Number.isFinite(p[1]);

function pinPosition(surfaces: Surface[], ref: PinRef): Vec2 | null {
  const s = surfaces.find((x) => x.id === ref.surfaceId);
  return s ? s.corners[ref.corner] : null;
}

/** Every pin, on any face, that sits on the same spot as `ref` (including `ref`). Empty if `ref` is unknown. */
export function gluedGroup(surfaces: Surface[], ref: PinRef, eps = GLUE_EPS): PinRef[] {
  const at = pinPosition(surfaces, ref);
  if (!at) return [];
  const out: PinRef[] = [];
  for (const s of surfaces) {
    for (const corner of CORNER_KEYS) {
      if (same(s.corners[corner], at, eps)) out.push({ surfaceId: s.id, corner });
    }
  }
  return out;
}

/**
 * The pin of ANOTHER face that the pointer `p` is close enough to snap onto, or null.
 * Distance is measured in screen pixels (so a non-square canvas is not distorted). Faces that
 * already have a pin in the dragged group (including the dragged pin's own face) are never targets.
 */
export function snapTarget(
  surfaces: Surface[],
  ref: PinRef,
  p: Vec2,
  radiusPx: number,
  size: { w: number; h: number },
): Vec2 | null {
  if (!finite2(p)) return null;
  if (!(Number.isFinite(size.w) && Number.isFinite(size.h) && size.w > 0 && size.h > 0)) return null;
  if (!(radiusPx > 0)) return null;
  const group = gluedGroup(surfaces, ref);
  if (group.length === 0) return null;
  const involved = new Set(group.map((g) => g.surfaceId));
  involved.add(ref.surfaceId);
  let best: Vec2 | null = null;
  let bestDistance = Infinity;
  for (const s of surfaces) {
    if (involved.has(s.id)) continue;
    for (const corner of CORNER_KEYS) {
      const c = s.corners[corner];
      const d = Math.hypot((c[0] - p[0]) * size.w, (c[1] - p[1]) * size.h);
      if (d <= radiusPx && d < bestDistance) {
        bestDistance = d;
        best = c;
      }
    }
  }
  return best ? [best[0], best[1]] : null;
}

/**
 * Move every pin in `pins` to `to`, all or nothing: null if `to` is not finite, `pins` is empty
 * or unknown, or ANY affected face would no longer be a valid quad. Faces that are not affected
 * come back as the same objects. The input is never mutated.
 */
export function movePins(surfaces: Surface[], pins: PinRef[], to: Vec2): Surface[] | null {
  if (!finite2(to) || pins.length === 0) return null;
  const byFace = new Map<string, CornerKey[]>();
  for (const pin of pins) {
    if (!surfaces.some((s) => s.id === pin.surfaceId)) return null;
    const list = byFace.get(pin.surfaceId) ?? [];
    if (!list.includes(pin.corner)) list.push(pin.corner);
    byFace.set(pin.surfaceId, list);
  }
  const out: Surface[] = [];
  for (const s of surfaces) {
    const moved = byFace.get(s.id);
    if (!moved) {
      out.push(s);
      continue;
    }
    const corners: Corners = { tl: s.corners.tl, tr: s.corners.tr, br: s.corners.br, bl: s.corners.bl };
    for (const corner of moved) corners[corner] = [to[0], to[1]];
    if (!isValidQuad(corners)) return null;
    out.push({ ...s, corners });
  }
  return out;
}

/**
 * The one entry point used by the Editor when a pin is dragged to `p`.
 * Glue on: the whole glued group moves, and snaps onto a nearby pin of another face.
 * Glue off: only the dragged pin moves and nothing snaps.
 */
export function moveGluedPin(
  surfaces: Surface[],
  ref: PinRef,
  p: Vec2,
  opts: { glue: boolean; radiusPx: number; size: { w: number; h: number } },
): Surface[] | null {
  if (!opts.glue) return movePins(surfaces, [ref], p);
  const group = gluedGroup(surfaces, ref);
  if (group.length === 0) return null;
  const to = snapTarget(surfaces, ref, p, opts.radiusPx, opts.size) ?? p;
  return movePins(surfaces, group, to);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/surfaces && npx tsc --noEmit && npm test`
Expected: PASS everywhere. If a hand-built geometry case does not behave as the test says (for example the "turns B inside out" point), recompute it by hand with the `isValidQuad` rule before touching the implementation; fix the test minimally and report exactly what and why; never weaken a test just to pass.

- [ ] **Step 5: Commit**

```bash
git add src/surfaces/glue.ts src/surfaces/glue.test.ts
git commit -m "feat(surfaces): glue logic - glued pins move together, snap, all or nothing

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The pin overlay, the Glue switch and the Editor wiring

**Files:**
- Modify (full replacement): `src/ui/PinOverlay.tsx`
- Modify: `src/ui/Editor.tsx` (anchored edits below), `README.md`

**Interfaces:**
- Consumes: `CORNER_KEYS`, `gluedGroup`, `moveGluedPin`, `SNAP_RADIUS_PX`, `PinRef`, `CornerKey` (glue.ts), `clampCorner`, `surfaceColor`.
- Produces: `<PinOverlay surfacesRef selectedId onPinMove repaintSignal />` where `onPinMove(ref: PinRef, p: Vec2, size: { w: number; h: number }) => boolean`.

UI wiring has no unit tests (Node env, no DOM). Verification is `tsc`, the full `npm test`, `npm run build`; say so explicitly.

- [ ] **Step 1: Replace `src/ui/PinOverlay.tsx` with**
```tsx
import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject, type PointerEvent } from 'react';
import { CORNER_KEYS, gluedGroup, type CornerKey, type PinRef } from '../surfaces/glue';
import { surfaceColor } from '../surfaces/model';
import type { Surface } from '../surfaces/types';
import { clampCorner } from '../warp/quad';
import type { Vec2 } from '../warp/types';

interface Props {
  surfacesRef: MutableRefObject<Surface[]>;
  selectedId: string;
  /**
   * A pin of the selected face was dragged to `p` (clamped, unit space). `size` is the overlay's
   * pixel size, needed to measure snapping in pixels. Return true if the move was accepted.
   */
  onPinMove: (ref: PinRef, p: Vec2, size: { w: number; h: number }) => boolean;
  /** Bump to repaint after surfacesRef was changed from outside (e.g. "Reset corners"). */
  repaintSignal?: number;
}

/**
 * Every face's outline. The four pins of the SELECTED face are draggable; the corners of the other
 * faces are small dim dots (so you can see where a pin will snap) and a ring marks a pin that is
 * glued to another. Positions are painted by mutating SVG attributes directly: a pointermove never
 * causes a React render.
 */
export function PinOverlay({ surfacesRef, selectedId, onPinMove, repaintSignal }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const circles = useRef<Partial<Record<CornerKey, SVGCircleElement | null>>>({});
  const rings = useRef<Partial<Record<CornerKey, SVGCircleElement | null>>>({});
  const dots = useRef<Record<string, SVGCircleElement | null>>({});
  const outlines = useRef<Record<string, SVGPolygonElement | null>>({});
  const dragging = useRef<CornerKey | null>(null);

  const paint = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const list = surfacesRef.current;
    for (const s of list) {
      const c = s.corners;
      outlines.current[s.id]?.setAttribute(
        'points',
        CORNER_KEYS.map((k) => `${c[k][0] * rect.width},${c[k][1] * rect.height}`).join(' '),
      );
      for (const k of CORNER_KEYS) {
        const x = String(c[k][0] * rect.width);
        const y = String(c[k][1] * rect.height);
        if (s.id === selectedId) {
          const pinEl = circles.current[k];
          pinEl?.setAttribute('cx', x);
          pinEl?.setAttribute('cy', y);
          const ring = rings.current[k];
          if (ring) {
            ring.setAttribute('cx', x);
            ring.setAttribute('cy', y);
            ring.setAttribute('opacity', gluedGroup(list, { surfaceId: s.id, corner: k }).length > 1 ? '1' : '0');
          }
        } else {
          const dot = dots.current[`${s.id}:${k}`];
          dot?.setAttribute('cx', x);
          dot?.setAttribute('cy', y);
        }
      }
    }
  }, [surfacesRef, selectedId]);

  // Repaint after every render: faces can be added/removed/selected between renders.
  useLayoutEffect(() => {
    paint();
  });

  useEffect(() => {
    const observer = new ResizeObserver(paint);
    if (svgRef.current) observer.observe(svgRef.current);
    return () => observer.disconnect();
  }, [paint]);

  useEffect(() => {
    if (repaintSignal !== undefined) paint();
  }, [repaintSignal, paint]);

  // A second finger changing the selection mid-drag must not leave a stale drag behind.
  useEffect(() => {
    dragging.current = null;
  }, [selectedId]);

  const onDown = (corner: CornerKey) => (e: PointerEvent<SVGCircleElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = corner;
  };

  const onMove = (corner: CornerKey) => (e: PointerEvent<SVGCircleElement>) => {
    if (dragging.current !== corner || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const p = clampCorner([(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height]);
    if (onPinMove({ surfaceId: selectedId, corner }, p, { w: rect.width, h: rect.height })) paint();
  };

  const onUp = (e: PointerEvent<SVGCircleElement>) => {
    dragging.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const list = surfacesRef.current;
  const selectedIndex = list.findIndex((s) => s.id === selectedId);
  const selectedColor = surfaceColor(Math.max(0, selectedIndex));

  return (
    // z-30: above the z-20 toolbar so a pin dragged under it can still be grabbed. The SVG
    // itself ignores pointers; only the selected face's circles take them.
    <svg ref={svgRef} className="pointer-events-none absolute inset-0 z-30 h-full w-full">
      {list.map((s, i) =>
        s.id === selectedId ? null : (
          <polygon
            key={s.id}
            ref={(el) => {
              outlines.current[s.id] = el;
            }}
            fill="none"
            strokeWidth={2}
            strokeDasharray="6 4"
            style={{ stroke: surfaceColor(i), opacity: 0.45 }}
          />
        ),
      )}
      {selectedIndex >= 0 && (
        <polygon
          key={selectedId}
          ref={(el) => {
            outlines.current[selectedId] = el;
          }}
          strokeWidth={2.5}
          style={{ stroke: selectedColor, fill: `${selectedColor}22` }}
        />
      )}
      {list.flatMap((s, i) =>
        s.id === selectedId
          ? []
          : CORNER_KEYS.map((k) => (
              <circle
                key={`${s.id}:${k}`}
                ref={(el) => {
                  dots.current[`${s.id}:${k}`] = el;
                }}
                r={5}
                style={{ fill: surfaceColor(i), opacity: 0.85 }}
              />
            )),
      )}
      {selectedIndex >= 0 &&
        CORNER_KEYS.map((k) => (
          <circle
            key={`ring-${k}`}
            ref={(el) => {
              rings.current[k] = el;
            }}
            r={38}
            fill="none"
            stroke="white"
            strokeWidth={2}
            strokeDasharray="4 3"
            opacity={0}
          />
        ))}
      {selectedIndex >= 0 &&
        CORNER_KEYS.map((k) => (
          <circle
            key={k}
            ref={(el) => {
              circles.current[k] = el;
            }}
            r={28}
            className="pointer-events-auto cursor-pointer touch-none fill-white/30"
            strokeWidth={3}
            style={{ stroke: selectedColor }}
            onPointerDown={onDown(k)}
            onPointerMove={onMove(k)}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
        ))}
    </svg>
  );
}
```

- [ ] **Step 2: Editor edits (`src/ui/Editor.tsx`)** — apply against the live file; if an anchor differs, adapt minimally and report it.

1. Change `import type { Corners } from '../warp/types';` to `import type { Corners, Vec2 } from '../warp/types';` and add, next to the other `../surfaces/...` imports:
```ts
import { SNAP_RADIUS_PX, moveGluedPin, type PinRef } from '../surfaces/glue';
```
2. After `const [setupsOpen, setSetupsOpen] = useState(false);` add:
```ts
  const [glue, setGlue] = useState(true); // pins on the same spot move together and snap; not saved
```
3. Immediately after the `onCornersChange` `useCallback` (the one used by Reset corners) add:
```tsx
  /**
   * A pin of the selected face was dragged. With Glue on, pins glued to it (same spot, any face) move
   * with it and it snaps onto a nearby pin of another face; a move that would break any face is refused.
   */
  const onPinMove = useCallback(
    (ref: PinRef, p: Vec2, size: { w: number; h: number }) => {
      const next = moveGluedPin(surfacesRef.current, ref, p, { glue, radiusPx: SNAP_RADIUS_PX, size });
      if (!next) return false;
      publish(next);
      return true;
    },
    [glue, publish],
  );
```
4. In the `<PinOverlay ... />` element replace the prop `onChange={onCornersChange}` with `onPinMove={onPinMove}` (leave `surfacesRef`, `selectedId`, `repaintSignal` as they are).
5. In the toolbar, right after the `Reset corners` button, add (note: exactly ONE `bg-*` class per state):
```tsx
          <button
            aria-pressed={glue}
            className={`rounded-lg px-4 py-3 ${glue ? 'bg-cyan-500 font-medium text-black' : 'bg-zinc-700'}`}
            onClick={() => setGlue((g) => !g)}
          >
            Glue: {glue ? 'on' : 'off'}
          </button>
```

- [ ] **Step 3: README**

At the end of the "Mapping a box (several faces)" section add this bullet:
```markdown
- **Glue** (toolbar, on by default): pins that sit on the same spot belong together. Drag one and the others move with it, so a box corner shared by three faces moves all three. Drag a pin close to a pin of another face and it snaps onto it. A small dim dot marks the corners of your other faces and a ring marks a glued pin. To pull a pin away from its neighbours, switch Glue **off**, drag it, then switch Glue back on. A move that would break any face is refused.
```

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all pass; no new unit tests in this task (React/DOM). In the report include a read-through list confirming: `onCornersChange` is still used (Reset corners); the overlay no longer references `onChange`; `paint()` updates outlines for ALL faces, the dots of non-selected faces, and the pins and rings of the selected face; rings show only for pins with a glued partner; no React state is set during a pointer move; `onPinMove` is stable across drags (deps `[glue, publish]`); the Glue button has exactly one `bg-*` class per state; a single-face layout behaves as before.
```bash
git add src/ui/PinOverlay.tsx src/ui/Editor.tsx README.md
git commit -m "feat(ui): Glue switch, partner dots and glue rings on the pin overlay

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** derived glue rule with `GLUE_EPS`, `gluedGroup`, pixel-radius `snapTarget` that excludes the dragged pin's own face and every face involved in the group, all-or-nothing `movePins`, Glue on/off `moveGluedPin` (Task 1); the overlay reporting pin moves with the canvas pixel size, dim dots on other faces' corners, glue rings, the toolbar switch (default on, not saved), `onPinMove` through the single `publish` path, README (Task 2). Spec edge cases 1-11: 1-9 and 11 are unit-tested in Task 1 (case 10, a single face behaves as before, is tested in Task 1 and read in Task 2); the "real Solve output is glued" assumption is tested directly.

**Placeholder scan:** none; every step carries full code.

**Type consistency:** `CornerKey`, `CORNER_KEYS`, `PinRef`, `GLUE_EPS`, `SNAP_RADIUS_PX`, `gluedGroup`, `snapTarget`, `movePins`, `moveGluedPin`, `onPinMove(ref, p, size)`, `Props` of `PinOverlay` are spelled identically wherever used.

**Refinement to the spec, stated plainly:** the spec says snapping excludes "the dragged pin's own face and members of its own glued group"; the plan excludes every face that has a pin in the group (so a group move never snaps onto a different corner of a partner face, which would collapse that face and make the whole move refuse). This is a strict refinement of the same intent and is covered by a test.

**Known risks to watch at execution time:** hand-built geometry in the tests (the points that make a face invalid); the exact sorted sizes `[1,1,1,2,2,2,3]` for the default Solve layout (derived by hand from the box: one three-way corner, three two-way corners, three outer corners); overlay painting of partner faces during a drag.
