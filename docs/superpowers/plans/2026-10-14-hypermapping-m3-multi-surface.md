# HyperMapping M3 (Multi-surface / box mapping) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the app map one video onto up to 6 independently pinned faces (to cover a box), where each face shows its own draggable rectangle ("slice") of the video.

**Architecture:** A pure `surfaces/` model (faces, slices, add/remove/resize rules) feeds a pure `SurfaceSync` that turns a face list into per-face vertex/UV buffers and reports exactly what changed. Both GPU backends keep one small position buffer and one UV buffer per face plus one shared index buffer, upload only what `SurfaceSync` reports, and draw all faces from a single video texture per frame. The Editor holds the face list in a ref (drags never re-render React), broadcasts the whole list over the existing channel, and the Output window renders it.

**Tech Stack:** React 18, TypeScript 5.9 (strict), Vite 5, Vitest 2, Tailwind 3, WebGPU / WebGL2 (unchanged).

**Spec:** `docs/superpowers/specs/2026-10-14-multi-surface-design.md` (builds on `2026-10-14-hypermapping-design.md`; M1 is shipped and phone-tested).

## Global Constraints

- Up to `MAX_SURFACES = 6` faces; at least 1 face always exists in the Editor.
- `MIN_SLICE = 0.05`: a slice is at least 5% of the video in width and height. A `SrcRect` is `{u0,v0,u1,v1}` in video space (0..1, v down) with `u0<u1`, `v0<v1`, all inside [0,1].
- `Surface = { id: string; corners: Corners; srcRect: SrcRect }`. `id` is a unique string of 1..32 characters. `corners` are in unit space (0..1 of the canvas, Y down), order tl, tr, br, bl.
- Four-corner pin keeps using the 3x3 homography (`warpedPositions`); 20x20 mesh (441 vertices, 2400 indices); NDC with Y flip. One shared index buffer for all faces.
- `Renderer.setCorners` is **replaced** by `Renderer.setSurfaces(surfaces: Surface[])`. A face with an invalid quad keeps its previous mesh; a face with an invalid `srcRect` keeps its previous UVs; other faces are never affected.
- The channel message `state` is **replaced** by `{ type: 'surfaces'; surfaces: Surface[] }`; `parseMsg` rebuilds objects from validated fields and returns `null` for anything invalid (duplicate ids, >6 faces, empty list, NaN, wrong types, bad slice).
- Pin drag state lives in refs and direct SVG attribute mutation (no React state per pointermove). Pins stay at `z-30`, above the `z-20` toolbar.
- No React.StrictMode. No new runtime dependencies.
- Every commit must pass `npx tsc --noEmit`, `npm test` and `npm run build`; all existing tests stay green and the test count only goes up.
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never `git add` anything under `.superpowers/`.
- Working directory for every command: `h:\HYPERFOCUSZONE\HperCore\HyperMapping`.

## Review Focus

1. **A bad quad on one face** (bow-tie, sliver, NaN) must freeze only that face at its last valid mesh while the other faces keep updating. Tested in Task 2 (`SurfaceSync`), enforced in Task 5 (`onCornersChange`).
2. **Face list edits**: deleting the selected face moves selection to a neighbour, deleting the last face is refused, adding at 6 is a no-op, ids stay unique after delete-then-add. Tested in Task 1.
3. **Slice editing extremes**: dragging a slice to zero size, negative size, or outside the video must clamp, never produce an invalid rect, and ignore NaN. Tested in Task 1.
4. **Output window late or Editor reloaded**: the `hello` reply and the creation broadcast restore all faces; malformed `surfaces` messages are ignored. Tested in Task 3; wiring in Task 5.
5. **Face churn must not leak GPU memory**: removed faces' buffers/VAOs are freed immediately; adding and removing faces repeatedly does not grow resources. `SurfaceSync` reports `removed` ids (tested in Task 2); backends free them (Task 4, reviewed by reading).

---

## File Structure

```
src/
  surfaces/types.ts            Surface, SrcRect, constants
  surfaces/model.ts            pure face/slice rules (+ model.test.ts)
  warp/mesh.ts                 + scaleUvs (+ mesh.test.ts additions)
  renderer/surface-sync.ts     pure per-face buffer bookkeeping (+ surface-sync.test.ts)
  renderer/types.ts            Renderer.setSurfaces replaces setCorners
  renderer/webgl2.ts           multi-surface (full rewrite below)
  renderer/webgpu.ts           multi-surface (full rewrite below)
  output/protocol.ts           'surfaces' message replaces 'state' (+ protocol.test.ts)
  ui/Editor.tsx                face list, selection, add/delete/reset, slice mode
  ui/PinOverlay.tsx            all outlines, selected face's pins interactive
  ui/SurfaceBar.tsx            face tabs, + Face, Delete, Edit slice
  ui/SliceEditor.tsx           draggable/resizable slice rectangle
  ui/Output.tsx                setSurfaces
README.md                      faces section
```

---

### Task 1: Surfaces model (pure)

**Files:**
- Create: `src/surfaces/types.ts`, `src/surfaces/model.ts`
- Test: `src/surfaces/model.test.ts`

**Interfaces:**
- Produces (`types.ts`): `SrcRect`, `Surface`, `MAX_SURFACES = 6`, `MIN_SLICE = 0.05`, `FULL_RECT`.
- Produces (`model.ts`): `defaultSlices(n): SrcRect[]`; `defaultCorners(index: number, total?: number): Corners`; `addSurface(list: Surface[]): Surface[]`; `removeSurface(list, id): Surface[]`; `selectAfterRemove(listBefore: Surface[], removedId: string): string`; `isValidSrcRect(r: SrcRect): boolean`; `moveRect(r, du, dv): SrcRect`; `type RectCorner = 'tl'|'tr'|'br'|'bl'`; `resizeRect(r, corner, u, v): SrcRect`; `isValidSurfaces(list: Surface[]): boolean`; `surfaceColor(index): string`.

- [ ] **Step 1: Write the failing test**

`src/surfaces/model.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  addSurface,
  defaultCorners,
  defaultSlices,
  isValidSrcRect,
  isValidSurfaces,
  moveRect,
  removeSurface,
  resizeRect,
  selectAfterRemove,
  surfaceColor,
} from './model';
import { FULL_RECT, MAX_SURFACES, MIN_SLICE, type Surface } from './types';
import { isValidQuad } from '../warp/quad';

const one = (): Surface[] => [{ id: 's1', corners: defaultCorners(0, 1), srcRect: FULL_RECT }];
const grow = (n: number): Surface[] => {
  let list = one();
  while (list.length < n) list = addSurface(list);
  return list;
};
const R = { u0: 0.2, v0: 0.2, u1: 0.6, v1: 0.6 };

describe('defaultSlices', () => {
  it('one slice is the full video', () => {
    expect(defaultSlices(1)).toEqual([FULL_RECT]);
  });
  it('splits into equal vertical strips that tile the video', () => {
    const s = defaultSlices(3);
    expect(s).toHaveLength(3);
    expect(s[0].u0).toBe(0);
    expect(s[2].u1).toBe(1);
    for (let i = 0; i < 2; i++) expect(s[i].u1).toBeCloseTo(s[i + 1].u0, 12);
    s.forEach((r) => {
      expect(r.v0).toBe(0);
      expect(r.v1).toBe(1);
      expect(r.u1 - r.u0).toBeCloseTo(1 / 3, 12);
    });
  });
  it('treats 0 as 1', () => {
    expect(defaultSlices(0)).toHaveLength(1);
  });
});

describe('defaultCorners', () => {
  it('a lone face is the big centred quad', () => {
    expect(defaultCorners(0, 1)).toEqual({ tl: [0.2, 0.2], tr: [0.8, 0.2], br: [0.8, 0.8], bl: [0.2, 0.8] });
  });
  it('every index/total combination is a valid quad inside the canvas', () => {
    for (let total = 1; total <= MAX_SURFACES; total++) {
      for (let i = 0; i < total; i++) {
        const c = defaultCorners(i, total);
        expect(isValidQuad(c)).toBe(true);
        [c.tl, c.tr, c.br, c.bl].forEach(([x, y]) => {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(1);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(1);
        });
      }
    }
  });
  it('faces in a multi-face layout do not start on top of each other', () => {
    const tls = [0, 1, 2, 3, 4, 5].map((i) => defaultCorners(i, 6).tl.join(','));
    expect(new Set(tls).size).toBe(6);
  });
});

describe('addSurface', () => {
  it('appends a face and re-balances automatic slices', () => {
    const two = addSurface(one());
    expect(two).toHaveLength(2);
    expect(two[0].srcRect.u1).toBeCloseTo(0.5, 12);
    expect(two[1].srcRect.u0).toBeCloseTo(0.5, 12);
    const three = addSurface(two);
    expect(three[0].srcRect.u1).toBeCloseTo(1 / 3, 12);
    expect(three[2].srcRect.u0).toBeCloseTo(2 / 3, 12);
  });
  it('keeps a slice the user customised', () => {
    const custom = { u0: 0.1, v0: 0.1, u1: 0.6, v1: 0.9 };
    const two = addSurface(one());
    const edited = [{ ...two[0], srcRect: custom }, two[1]];
    const three = addSurface(edited);
    expect(three[0].srcRect).toEqual(custom);
    expect(three[1].srcRect.u0).toBeCloseTo(1 / 3, 12); // still automatic, so re-balanced
  });
  it('is a no-op at the maximum', () => {
    const full = grow(MAX_SURFACES);
    expect(full).toHaveLength(MAX_SURFACES);
    expect(addSurface(full)).toBe(full);
  });
  it('keeps ids unique after delete-then-add', () => {
    const three = grow(3);
    const without = removeSurface(three, three[1].id);
    const again = addSurface(without);
    expect(new Set(again.map((s) => s.id)).size).toBe(3);
  });
});

describe('removeSurface', () => {
  it('removes by id and keeps order', () => {
    const three = grow(3);
    const out = removeSurface(three, three[1].id);
    expect(out.map((s) => s.id)).toEqual([three[0].id, three[2].id]);
  });
  it('refuses to remove the last face', () => {
    const l = one();
    expect(removeSurface(l, 's1')).toBe(l);
  });
  it('ignores an unknown id', () => {
    const l = grow(2);
    expect(removeSurface(l, 'nope')).toBe(l);
  });
});

describe('selectAfterRemove', () => {
  it('prefers the previous neighbour, else the next', () => {
    const l = grow(3);
    expect(selectAfterRemove(l, l[1].id)).toBe(l[0].id);
    expect(selectAfterRemove(l, l[2].id)).toBe(l[1].id);
    expect(selectAfterRemove(l, l[0].id)).toBe(l[1].id);
  });
});

describe('isValidSrcRect', () => {
  it('accepts the full rect and a normal slice', () => {
    expect(isValidSrcRect(FULL_RECT)).toBe(true);
    expect(isValidSrcRect(R)).toBe(true);
  });
  it('rejects tiny, inverted, out-of-range and non-finite rects', () => {
    expect(isValidSrcRect({ u0: 0.2, v0: 0, u1: 0.2 + MIN_SLICE / 2, v1: 1 })).toBe(false);
    expect(isValidSrcRect({ u0: 0.6, v0: 0, u1: 0.2, v1: 1 })).toBe(false);
    expect(isValidSrcRect({ u0: -0.1, v0: 0, u1: 0.5, v1: 1 })).toBe(false);
    expect(isValidSrcRect({ u0: 0, v0: 0, u1: 1.1, v1: 1 })).toBe(false);
    expect(isValidSrcRect({ u0: NaN, v0: 0, u1: 1, v1: 1 })).toBe(false);
  });
});

describe('moveRect', () => {
  it('moves without changing size', () => {
    const m = moveRect(R, 0.1, 0.05);
    expect(m.u0).toBeCloseTo(0.3, 12);
    expect(m.u1 - m.u0).toBeCloseTo(0.4, 12);
    expect(isValidSrcRect(m)).toBe(true);
  });
  it('clamps at the edges and keeps the size', () => {
    const br = moveRect(R, 5, 5);
    expect(br.u1).toBeCloseTo(1, 12);
    expect(br.v1).toBeCloseTo(1, 12);
    expect(br.u1 - br.u0).toBeCloseTo(0.4, 12);
    const tl = moveRect(R, -5, -5);
    expect(tl.u0).toBeCloseTo(0, 12);
    expect(tl.v0).toBeCloseTo(0, 12);
    expect(isValidSrcRect(br) && isValidSrcRect(tl)).toBe(true);
  });
  it('treats NaN deltas as zero', () => {
    const m = moveRect(R, NaN, NaN);
    (['u0', 'v0', 'u1', 'v1'] as const).forEach((k) => expect(m[k]).toBeCloseTo(R[k], 12));
  });
});

describe('resizeRect', () => {
  it('drags the named corner and leaves the opposite corner alone', () => {
    const r = resizeRect(R, 'br', 0.8, 0.9);
    expect(r).toEqual({ u0: 0.2, v0: 0.2, u1: 0.8, v1: 0.9 });
  });
  it('clamps to the video bounds', () => {
    const r = resizeRect(R, 'tl', -5, -5);
    expect(r.u0).toBe(0);
    expect(r.v0).toBe(0);
    const r2 = resizeRect(R, 'br', 9, 9);
    expect(r2.u1).toBe(1);
    expect(r2.v1).toBe(1);
  });
  it('never collapses below MIN_SLICE or crosses the opposite corner', () => {
    const r = resizeRect(R, 'tl', 0.9, 0.9);
    expect(r.u0).toBeCloseTo(R.u1 - MIN_SLICE, 12);
    expect(r.v0).toBeCloseTo(R.v1 - MIN_SLICE, 12);
    expect(isValidSrcRect(r)).toBe(true);
    const r2 = resizeRect(R, 'br', 0, 0);
    expect(r2.u1).toBeCloseTo(R.u0 + MIN_SLICE, 12);
    expect(isValidSrcRect(r2)).toBe(true);
  });
  it('ignores non-finite pointer values', () => {
    expect(resizeRect(R, 'tr', NaN, Infinity).u1).toBeLessThanOrEqual(1);
    expect(isValidSrcRect(resizeRect(R, 'tr', NaN, NaN))).toBe(true);
    expect(resizeRect(R, 'tr', NaN, NaN)).toEqual(R);
  });
});

describe('isValidSurfaces', () => {
  it('accepts 1..6 well-formed faces', () => {
    expect(isValidSurfaces(one())).toBe(true);
    expect(isValidSurfaces(grow(6))).toBe(true);
  });
  it('rejects empty, too many, duplicate or bad ids', () => {
    expect(isValidSurfaces([])).toBe(false);
    expect(isValidSurfaces([...grow(6), { ...one()[0], id: 'extra' }])).toBe(false);
    const l = grow(2);
    expect(isValidSurfaces([l[0], { ...l[1], id: l[0].id }])).toBe(false);
    expect(isValidSurfaces([{ ...one()[0], id: '' }])).toBe(false);
    expect(isValidSurfaces([{ ...one()[0], id: 'x'.repeat(33) }])).toBe(false);
  });
  it('rejects a bad slice or non-finite corners', () => {
    expect(isValidSurfaces([{ ...one()[0], srcRect: { u0: 0.5, v0: 0, u1: 0.5, v1: 1 } }])).toBe(false);
    const c = defaultCorners(0, 1);
    expect(isValidSurfaces([{ ...one()[0], corners: { ...c, tl: [NaN, 0] } }])).toBe(false);
  });
});

describe('surfaceColor', () => {
  it('has six distinct colours and wraps', () => {
    const colors = [0, 1, 2, 3, 4, 5].map(surfaceColor);
    expect(new Set(colors).size).toBe(6);
    expect(surfaceColor(6)).toBe(colors[0]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/surfaces`
Expected: FAIL — `./model` / `./types` not found.

- [ ] **Step 3: Implement**

`src/surfaces/types.ts`:
```ts
import type { Corners } from '../warp/types';

/** A rectangle of the video, in video space: 0..1, v down (v = 0 is the top row). */
export interface SrcRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** One mapped face: where it sits on the canvas, and which slice of the video it shows. */
export interface Surface {
  id: string;
  corners: Corners;
  srcRect: SrcRect;
}

export const MAX_SURFACES = 6;
/** A slice is never smaller than this fraction of the video, in width or height. */
export const MIN_SLICE = 0.05;
export const FULL_RECT: SrcRect = { u0: 0, v0: 0, u1: 1, v1: 1 };
```

`src/surfaces/model.ts`:
```ts
import type { Corners } from '../warp/types';
import { FULL_RECT, MAX_SURFACES, MIN_SLICE, type SrcRect, type Surface } from './types';

const EPS = 1e-9;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const fin = (n: number, fallback: number) => (Number.isFinite(n) ? n : fallback);

const rectsEqual = (a: SrcRect, b: SrcRect) =>
  Math.abs(a.u0 - b.u0) < EPS && Math.abs(a.v0 - b.v0) < EPS && Math.abs(a.u1 - b.u1) < EPS && Math.abs(a.v1 - b.v1) < EPS;

/** n equal vertical strips covering the full height of the video. */
export function defaultSlices(n: number): SrcRect[] {
  const count = Math.max(1, Math.floor(n));
  return Array.from({ length: count }, (_, i) => ({ u0: i / count, v0: 0, u1: (i + 1) / count, v1: 1 }));
}

/**
 * Starting pins for face `index` of `total`. A lone face is the big centred quad;
 * with several faces they start in a 3x2 grid so they do not sit on top of each other.
 */
export function defaultCorners(index: number, total = 1): Corners {
  if (total <= 1) return { tl: [0.2, 0.2], tr: [0.8, 0.2], br: [0.8, 0.8], bl: [0.2, 0.8] };
  const col = index % 3;
  const row = Math.floor(index / 3) % 2;
  const cw = 1 / 3;
  const ch = 1 / 2;
  const mx = cw * 0.12;
  const my = ch * 0.12;
  const x0 = col * cw + mx;
  const x1 = (col + 1) * cw - mx;
  const y0 = row * ch + my;
  const y1 = (row + 1) * ch - my;
  return { tl: [x0, y0], tr: [x1, y0], br: [x1, y1], bl: [x0, y1] };
}

function nextId(list: Surface[]): string {
  const used = new Set(list.map((s) => s.id));
  let n = 1;
  while (used.has(`s${n}`)) n++;
  return `s${n}`;
}

/**
 * Add a face (no-op at MAX_SURFACES). Faces still on their automatic slice are
 * re-balanced to the new count; slices the user customised are kept.
 */
export function addSurface(list: Surface[]): Surface[] {
  if (list.length >= MAX_SURFACES) return list;
  const oldN = list.length;
  const newN = oldN + 1;
  const oldDefaults = defaultSlices(oldN);
  const newDefaults = defaultSlices(newN);
  const rebalanced = list.map((s, i) => (rectsEqual(s.srcRect, oldDefaults[i]) ? { ...s, srcRect: newDefaults[i] } : s));
  return [...rebalanced, { id: nextId(list), corners: defaultCorners(oldN, newN), srcRect: newDefaults[oldN] }];
}

/** Remove a face. Never removes the last one; unknown ids are ignored. */
export function removeSurface(list: Surface[], id: string): Surface[] {
  if (list.length <= 1 || !list.some((s) => s.id === id)) return list;
  return list.filter((s) => s.id !== id);
}

/** Which face to select after `removedId` is removed from `listBefore`. */
export function selectAfterRemove(listBefore: Surface[], removedId: string): string {
  const idx = listBefore.findIndex((s) => s.id === removedId);
  const after = listBefore.filter((s) => s.id !== removedId);
  if (after.length === 0) return removedId;
  return after[Math.max(0, idx - 1)].id;
}

export function isValidSrcRect(r: SrcRect): boolean {
  const all = [r.u0, r.v0, r.u1, r.v1];
  if (!all.every(Number.isFinite)) return false;
  if (r.u0 < 0 || r.v0 < 0 || r.u1 > 1 || r.v1 > 1) return false;
  return r.u1 - r.u0 >= MIN_SLICE - EPS && r.v1 - r.v0 >= MIN_SLICE - EPS;
}

/** Slide a slice, keeping its size and staying inside the video. */
export function moveRect(r: SrcRect, du: number, dv: number): SrcRect {
  if (!isValidSrcRect(r)) return r;
  const w = r.u1 - r.u0;
  const h = r.v1 - r.v0;
  const u0 = clamp(r.u0 + fin(du, 0), 0, 1 - w);
  const v0 = clamp(r.v0 + fin(dv, 0), 0, 1 - h);
  return { u0, v0, u1: Math.min(1, u0 + w), v1: Math.min(1, v0 + h) };
}

export type RectCorner = 'tl' | 'tr' | 'br' | 'bl';

/** Drag one corner of a slice to (u, v); the opposite corner stays put. Never returns an invalid rect. */
export function resizeRect(r: SrcRect, corner: RectCorner, u: number, v: number): SrcRect {
  if (!isValidSrcRect(r)) return r;
  const movesLeft = corner === 'tl' || corner === 'bl';
  const movesTop = corner === 'tl' || corner === 'tr';
  let { u0, v0, u1, v1 } = r;
  if (movesLeft) u0 = clamp(fin(u, u0), 0, u1 - MIN_SLICE);
  else u1 = clamp(fin(u, u1), u0 + MIN_SLICE, 1);
  if (movesTop) v0 = clamp(fin(v, v0), 0, v1 - MIN_SLICE);
  else v1 = clamp(fin(v, v1), v0 + MIN_SLICE, 1);
  return { u0, v0, u1, v1 };
}

const isFiniteVec2 = (p: readonly number[]) => p.length === 2 && p.every(Number.isFinite);

/** Structural validity of a face list (does not require the quads to be convex; the renderer freezes bad quads). */
export function isValidSurfaces(list: Surface[]): boolean {
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_SURFACES) return false;
  const ids = new Set<string>();
  for (const s of list) {
    if (typeof s.id !== 'string' || s.id.length < 1 || s.id.length > 32 || ids.has(s.id)) return false;
    ids.add(s.id);
    if (!isValidSrcRect(s.srcRect)) return false;
    const c = s.corners;
    if (!(isFiniteVec2(c.tl) && isFiniteVec2(c.tr) && isFiniteVec2(c.br) && isFiniteVec2(c.bl))) return false;
  }
  return true;
}

const PALETTE = ['#22d3ee', '#f472b6', '#a3e635', '#fb923c', '#a78bfa', '#facc15'];
export const surfaceColor = (index: number): string => PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length];

export { FULL_RECT };
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/surfaces && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/surfaces
git commit -m "feat(surfaces): face and slice model (add/remove/move/resize/validate)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: UV scaling and per-face buffer bookkeeping (pure)

**Files:**
- Modify: `src/warp/mesh.ts` (add `scaleUvs`)
- Create: `src/renderer/surface-sync.ts`
- Test: `src/warp/mesh.test.ts` (append), `src/renderer/surface-sync.test.ts`

**Interfaces:**
- Consumes: `buildTopology`, `warpedPositions`, `GRID`, `unitToNdc` (mesh.ts); `isValidSrcRect`, `FULL_RECT`, `Surface`, `SrcRect` (Task 1); `UNIT_CORNERS`, `Corners`.
- Produces: `scaleUvs(base: Float32Array, rect: SrcRect, out?: Float32Array): Float32Array`; `SurfaceBuffers { positions: Float32Array<ArrayBuffer>; uvs: Float32Array<ArrayBuffer> }`; `SyncResult { removed; created; changedPositions; changedUvs; order }` (all `string[]`); `class SurfaceSync { sync(surfaces: Surface[]): SyncResult; buffers(id: string): SurfaceBuffers | undefined }`.

- [ ] **Step 1: Write the failing tests**

Append to `src/warp/mesh.test.ts`:
```ts
import { scaleUvs } from './mesh';

describe('scaleUvs', () => {
  it('maps the base 0..1 UVs into the slice', () => {
    const t = buildTopology();
    const out = scaleUvs(t.uvs, { u0: 0.25, v0: 0.1, u1: 0.75, v1: 0.9 });
    expect(out.length).toBe(882);
    expect([out[0], out[1]].map((n) => +n.toFixed(5))).toEqual([0.25, 0.1]);
    expect([out[880], out[881]].map((n) => +n.toFixed(5))).toEqual([0.75, 0.9]);
    expect([out[40], out[41]].map((n) => +n.toFixed(5))).toEqual([0.75, 0.1]); // vertex 20 = top-right
  });
  it('the full rect leaves UVs unchanged', () => {
    const t = buildTopology();
    const out = scaleUvs(t.uvs, { u0: 0, v0: 0, u1: 1, v1: 1 });
    expect(Array.from(out)).toEqual(Array.from(t.uvs));
  });
  it('writes into a provided buffer and returns it', () => {
    const t = buildTopology();
    const buf = new Float32Array(882);
    expect(scaleUvs(t.uvs, { u0: 0, v0: 0, u1: 0.5, v1: 1 }, buf)).toBe(buf);
  });
});
```
(The file already imports `describe`, `it`, `expect`, `buildTopology`; add `scaleUvs` to the existing import from `./mesh` instead of a second import line if lint complains.)

`src/renderer/surface-sync.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { SurfaceSync } from './surface-sync';
import { unitToNdc } from '../warp/mesh';
import { FULL_RECT, type Surface } from '../surfaces/types';
import type { Corners } from '../warp/types';

const quad: Corners = { tl: [0.2, 0.2], tr: [0.8, 0.25], br: [0.75, 0.8], bl: [0.15, 0.7] };
const quad2: Corners = { tl: [0.1, 0.1], tr: [0.9, 0.1], br: [0.9, 0.9], bl: [0.1, 0.9] };
const bow: Corners = { tl: [0, 0], tr: [1, 0], br: [0, 1], bl: [1, 1] };
const face = (id: string, corners: Corners = quad, srcRect = FULL_RECT): Surface => ({ id, corners, srcRect });
const V = (a: Float32Array, i: number) => [a[2 * i], a[2 * i + 1]];

describe('SurfaceSync', () => {
  it('creates buffers for new faces and reports them as changed', () => {
    const sync = new SurfaceSync();
    const r = sync.sync([face('a'), face('b', quad2)]);
    expect(r.created).toEqual(['a', 'b']);
    expect(r.changedPositions).toEqual(['a', 'b']);
    expect(r.changedUvs).toEqual(['a', 'b']);
    expect(r.removed).toEqual([]);
    expect(r.order).toEqual(['a', 'b']);
    const a = sync.buffers('a')!;
    expect(a.positions.length).toBe(882);
    expect(a.uvs.length).toBe(882);
    const [x, y] = unitToNdc(quad.tl);
    expect(V(a.positions, 0)[0]).toBeCloseTo(x, 6);
    expect(V(a.positions, 0)[1]).toBeCloseTo(y, 6);
  });

  it('reports nothing when the same list is synced again', () => {
    const sync = new SurfaceSync();
    sync.sync([face('a')]);
    const r = sync.sync([face('a')]);
    expect(r).toEqual({ removed: [], created: [], changedPositions: [], changedUvs: [], order: ['a'] });
  });

  it('a corner change updates only positions', () => {
    const sync = new SurfaceSync();
    sync.sync([face('a')]);
    const r = sync.sync([face('a', quad2)]);
    expect(r.changedPositions).toEqual(['a']);
    expect(r.changedUvs).toEqual([]);
    const [x, y] = unitToNdc(quad2.tl);
    expect(V(sync.buffers('a')!.positions, 0)[0]).toBeCloseTo(x, 6);
    expect(V(sync.buffers('a')!.positions, 0)[1]).toBeCloseTo(y, 6);
  });

  it('a slice change updates only UVs, scaled into the slice', () => {
    const sync = new SurfaceSync();
    sync.sync([face('a')]);
    const r = sync.sync([face('a', quad, { u0: 0.25, v0: 0.1, u1: 0.75, v1: 0.9 })]);
    expect(r.changedUvs).toEqual(['a']);
    expect(r.changedPositions).toEqual([]);
    const uv = sync.buffers('a')!.uvs;
    expect(V(uv, 0)[0]).toBeCloseTo(0.25, 5);
    expect(V(uv, 0)[1]).toBeCloseTo(0.1, 5);
    expect(V(uv, 440)[0]).toBeCloseTo(0.75, 5);
    expect(V(uv, 440)[1]).toBeCloseTo(0.9, 5);
  });

  it('a bad quad freezes only that face; others still update', () => {
    const sync = new SurfaceSync();
    sync.sync([face('a'), face('b')]);
    const before = Array.from(sync.buffers('a')!.positions);
    const r = sync.sync([face('a', bow), face('b', quad2)]);
    expect(r.changedPositions).toEqual(['b']);
    expect(Array.from(sync.buffers('a')!.positions)).toEqual(before);
    expect(sync.buffers('a')!.positions.every(Number.isFinite)).toBe(true);
  });

  it('a bad slice keeps the previous UVs', () => {
    const sync = new SurfaceSync();
    sync.sync([face('a', quad, { u0: 0.25, v0: 0.1, u1: 0.75, v1: 0.9 })]);
    const before = Array.from(sync.buffers('a')!.uvs);
    const r = sync.sync([face('a', quad, { u0: 0.8, v0: 0.1, u1: 0.2, v1: 0.9 })]);
    expect(r.changedUvs).toEqual([]);
    expect(Array.from(sync.buffers('a')!.uvs)).toEqual(before);
  });

  it('a new face with an invalid quad starts as the full-canvas quad', () => {
    const sync = new SurfaceSync();
    sync.sync([face('a', bow)]);
    const p = sync.buffers('a')!.positions;
    expect(V(p, 0)).toEqual([-1, 1]);
    expect(V(p, 440)).toEqual([1, -1]);
  });

  it('a new face with an invalid slice starts with the full video', () => {
    const sync = new SurfaceSync();
    sync.sync([face('a', quad, { u0: 0.9, v0: 0, u1: 0.1, v1: 1 })]);
    const uv = sync.buffers('a')!.uvs;
    expect(V(uv, 0)).toEqual([0, 0]);
    expect(V(uv, 440)).toEqual([1, 1]);
  });

  it('reports removed faces, forgets their buffers, and keeps list order', () => {
    const sync = new SurfaceSync();
    sync.sync([face('a'), face('b'), face('c')]);
    const r = sync.sync([face('c'), face('a')]);
    expect(r.removed).toEqual(['b']);
    expect(sync.buffers('b')).toBeUndefined();
    expect(r.order).toEqual(['c', 'a']);
    expect(r.created).toEqual([]);
  });

  it('churn does not accumulate state', () => {
    const sync = new SurfaceSync();
    for (let i = 0; i < 50; i++) {
      sync.sync([face('a'), face('tmp' + i)]);
      sync.sync([face('a')]);
    }
    expect(sync.buffers('tmp49')).toBeUndefined();
    expect(sync.sync([face('a')]).removed).toEqual([]);
  });

  it('an empty list removes everything', () => {
    const sync = new SurfaceSync();
    sync.sync([face('a')]);
    const r = sync.sync([]);
    expect(r.removed).toEqual(['a']);
    expect(r.order).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/warp/mesh.test.ts src/renderer/surface-sync.test.ts`
Expected: FAIL — `scaleUvs` is not exported; `./surface-sync` not found.

- [ ] **Step 3: Implement**

Append to `src/warp/mesh.ts` (and add `import type { SrcRect } from '../surfaces/types';` at the top):
```ts
/** Map the base 0..1 mesh UVs into a slice of the video: u = u0 + baseU*(u1-u0), same for v. */
export function scaleUvs(base: Float32Array, rect: SrcRect, out?: Float32Array): Float32Array {
  const buf = out ?? new Float32Array(base.length);
  const du = rect.u1 - rect.u0;
  const dv = rect.v1 - rect.v0;
  for (let i = 0; i < base.length; i += 2) {
    buf[i] = rect.u0 + base[i] * du;
    buf[i + 1] = rect.v0 + base[i + 1] * dv;
  }
  return buf;
}
```

`src/renderer/surface-sync.ts`:
```ts
import { isValidSrcRect } from '../surfaces/model';
import { FULL_RECT, type SrcRect, type Surface } from '../surfaces/types';
import { GRID, buildTopology, scaleUvs, warpedPositions } from '../warp/mesh';
import { UNIT_CORNERS, type Corners } from '../warp/types';

type F32 = Float32Array<ArrayBuffer>;

export interface SurfaceBuffers {
  positions: F32;
  uvs: F32;
}

export interface SyncResult {
  /** Faces that no longer exist: free their GPU buffers now. */
  removed: string[];
  /** Faces seen for the first time: allocate GPU buffers (they also appear in both changed lists). */
  created: string[];
  /** Faces whose position buffer must be re-uploaded. */
  changedPositions: string[];
  /** Faces whose UV buffer must be re-uploaded. */
  changedUvs: string[];
  /** Draw order (list order). */
  order: string[];
}

interface Entry extends SurfaceBuffers {
  /** Last requested values, so an unchanged or repeatedly invalid request costs nothing. */
  wantCorners: Corners;
  wantRect: SrcRect;
}

const same = (a: readonly number[], b: readonly number[]) => a[0] === b[0] && a[1] === b[1];
const sameCorners = (a: Corners, b: Corners) => same(a.tl, b.tl) && same(a.tr, b.tr) && same(a.br, b.br) && same(a.bl, b.bl);
const sameRect = (a: SrcRect, b: SrcRect) => a.u0 === b.u0 && a.v0 === b.v0 && a.u1 === b.u1 && a.v1 === b.v1;
const cloneCorners = (c: Corners): Corners => ({
  tl: [c.tl[0], c.tl[1]],
  tr: [c.tr[0], c.tr[1]],
  br: [c.br[0], c.br[1]],
  bl: [c.bl[0], c.bl[1]],
});

/**
 * Pure bookkeeping shared by both GPU backends: turns a face list into per-face vertex
 * and UV arrays and says exactly which GPU buffers to allocate, upload or free.
 * A face with an invalid quad keeps its previous positions; an invalid slice keeps its
 * previous UVs; neither affects any other face.
 */
export class SurfaceSync {
  private entries = new Map<string, Entry>();
  private baseUvs = buildTopology().uvs;
  private floats = this.baseUvs.length;

  buffers(id: string): SurfaceBuffers | undefined {
    return this.entries.get(id);
  }

  sync(surfaces: Surface[]): SyncResult {
    const result: SyncResult = {
      removed: [],
      created: [],
      changedPositions: [],
      changedUvs: [],
      order: surfaces.map((s) => s.id),
    };
    const present = new Set(result.order);
    for (const id of [...this.entries.keys()]) {
      if (!present.has(id)) {
        this.entries.delete(id);
        result.removed.push(id);
      }
    }
    for (const s of surfaces) {
      const existing = this.entries.get(s.id);
      if (!existing) {
        this.entries.set(s.id, this.create(s));
        result.created.push(s.id);
        result.changedPositions.push(s.id);
        result.changedUvs.push(s.id);
        continue;
      }
      if (!sameCorners(existing.wantCorners, s.corners)) {
        existing.wantCorners = cloneCorners(s.corners);
        if (warpedPositions(s.corners, GRID, GRID, existing.positions)) result.changedPositions.push(s.id);
      }
      if (!sameRect(existing.wantRect, s.srcRect)) {
        existing.wantRect = { ...s.srcRect };
        if (isValidSrcRect(s.srcRect)) {
          scaleUvs(this.baseUvs, s.srcRect, existing.uvs);
          result.changedUvs.push(s.id);
        }
      }
    }
    return result;
  }

  private create(s: Surface): Entry {
    const positions = new Float32Array(this.floats);
    // An invalid quad on a brand-new face falls back to the full-canvas quad, never garbage.
    if (!warpedPositions(s.corners, GRID, GRID, positions)) warpedPositions(UNIT_CORNERS, GRID, GRID, positions);
    const uvs = new Float32Array(this.floats);
    scaleUvs(this.baseUvs, isValidSrcRect(s.srcRect) ? s.srcRect : FULL_RECT, uvs);
    return { positions, uvs, wantCorners: cloneCorners(s.corners), wantRect: { ...s.srcRect } };
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/warp src/renderer/surface-sync.test.ts && npx tsc --noEmit`
Expected: PASS. If `tsc` rejects a `Float32Array<ArrayBuffer>` vs `Float32Array` mismatch in `scaleUvs`'s `out` parameter, widen nothing: the parameter type `Float32Array` already accepts it; only fix a genuine error.

- [ ] **Step 5: Commit**

```bash
git add src/warp src/renderer/surface-sync.ts src/renderer/surface-sync.test.ts
git commit -m "feat(renderer): scaleUvs and pure per-face buffer sync

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Channel protocol carries the face list

The protocol changes and the two call sites move to the new message while the renderer still takes a single quad, so the app keeps working (one face) at this commit.

**Files:**
- Modify: `src/output/protocol.ts`, `src/output/protocol.test.ts`, `src/ui/Editor.tsx`, `src/ui/Output.tsx`

**Interfaces:**
- Consumes: `Surface`, `FULL_RECT`, `MAX_SURFACES` (types), `isValidSurfaces` (model).
- Produces: `Msg = { type:'hello' } | { type:'surfaces'; surfaces: Surface[] } | { type:'video'; blob: Blob }`; `parseMsg` as before.

- [ ] **Step 1: Write the failing tests**

Replace the three `state` tests in `src/output/protocol.test.ts` (keep `hello`, `video`, unknown/non-object tests) with:
```ts
const rect = { u0: 0, v0: 0, u1: 1, v1: 1 };
const surface = (id = 's1', over: Record<string, unknown> = {}) => ({ id, corners, srcRect: rect, ...over });

  it('accepts a well-formed surfaces message', () => {
    const msg = { type: 'surfaces', surfaces: [surface('s1'), surface('s2')] };
    expect(parseMsg(msg)).toEqual(msg);
  });
  it('strips unknown fields (rebuilds from validated parts)', () => {
    const out = parseMsg({ type: 'surfaces', surfaces: [surface('s1', { evil: 1 })], extra: true });
    expect(out).toEqual({ type: 'surfaces', surfaces: [surface('s1')] });
  });
  it('rejects an empty list, more than 6 faces and a non-array', () => {
    expect(parseMsg({ type: 'surfaces', surfaces: [] })).toBeNull();
    const seven = Array.from({ length: 7 }, (_, i) => surface('s' + (i + 1)));
    expect(parseMsg({ type: 'surfaces', surfaces: seven })).toBeNull();
    expect(parseMsg({ type: 'surfaces', surfaces: 'nope' })).toBeNull();
    expect(parseMsg({ type: 'surfaces' })).toBeNull();
  });
  it('rejects duplicate, missing, non-string and over-long ids', () => {
    expect(parseMsg({ type: 'surfaces', surfaces: [surface('a'), surface('a')] })).toBeNull();
    expect(parseMsg({ type: 'surfaces', surfaces: [surface('', {})] })).toBeNull();
    expect(parseMsg({ type: 'surfaces', surfaces: [surface('a', { id: 5 })] })).toBeNull();
    expect(parseMsg({ type: 'surfaces', surfaces: [surface('x'.repeat(33))] })).toBeNull();
  });
  it('rejects a face with a missing or non-finite corner', () => {
    expect(parseMsg({ type: 'surfaces', surfaces: [surface('a', { corners: { tl: [0, 0] } })] })).toBeNull();
    expect(parseMsg({ type: 'surfaces', surfaces: [surface('a', { corners: { ...corners, tl: [NaN, 0] } })] })).toBeNull();
  });
  it('rejects a bad slice: missing, zero-size, inverted, out of range, non-finite', () => {
    const bad = (srcRect: unknown) => parseMsg({ type: 'surfaces', surfaces: [surface('a', { srcRect })] });
    expect(bad(undefined)).toBeNull();
    expect(bad({ u0: 0.5, v0: 0, u1: 0.5, v1: 1 })).toBeNull();
    expect(bad({ u0: 0.8, v0: 0, u1: 0.2, v1: 1 })).toBeNull();
    expect(bad({ u0: -0.1, v0: 0, u1: 1, v1: 1 })).toBeNull();
    expect(bad({ u0: 0, v0: 0, u1: 1.5, v1: 1 })).toBeNull();
    expect(bad({ u0: NaN, v0: 0, u1: 1, v1: 1 })).toBeNull();
    expect(bad({ u0: '0', v0: 0, u1: 1, v1: 1 })).toBeNull();
  });
  it('no longer accepts the old state message', () => {
    expect(parseMsg({ type: 'state', corners })).toBeNull();
  });
```
(Place `const rect`/`surface` helpers next to the existing `corners` constant at the top of the file; the `it(...)` blocks go inside the existing `describe('parseMsg', ...)`.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/output`
Expected: FAIL — `surfaces` returns `null` / `state` still accepted.

- [ ] **Step 3: Implement the protocol**

Replace `src/output/protocol.ts` with:
```ts
import { isValidSurfaces } from '../surfaces/model';
import { MAX_SURFACES, type Surface } from '../surfaces/types';
import type { Vec2 } from '../warp/types';

export const CHANNEL = 'hypermapping';

export type Msg =
  | { type: 'hello' } // output window -> editor: "send me everything you have"
  | { type: 'surfaces'; surfaces: Surface[] } // editor -> output: the whole face list
  | { type: 'video'; blob: Blob }; // editor -> output (structured-clone copy)

const isVec2 = (v: unknown): v is Vec2 =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** Rebuild one face from validated parts only; anything unexpected rejects the whole message. */
function parseSurface(raw: unknown): Surface | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const s = raw as Record<string, unknown>;
  const c = s.corners as Record<string, unknown> | undefined;
  const r = s.srcRect as Record<string, unknown> | undefined;
  if (typeof s.id !== 'string' || !c || !r) return null;
  if (!(isVec2(c.tl) && isVec2(c.tr) && isVec2(c.br) && isVec2(c.bl))) return null;
  if (!(isNum(r.u0) && isNum(r.v0) && isNum(r.u1) && isNum(r.v1))) return null;
  return {
    id: s.id,
    corners: { tl: c.tl, tr: c.tr, br: c.br, bl: c.bl },
    srcRect: { u0: r.u0, v0: r.v0, u1: r.u1, v1: r.v1 },
  };
}

/** Validate anything that arrives on the channel; never trust the wire. */
export function parseMsg(data: unknown): Msg | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  switch (d.type) {
    case 'hello':
      return { type: 'hello' };
    case 'surfaces': {
      if (!Array.isArray(d.surfaces) || d.surfaces.length > MAX_SURFACES) return null;
      const out: Surface[] = [];
      for (const raw of d.surfaces) {
        const s = parseSurface(raw);
        if (!s) return null;
        out.push(s);
      }
      return isValidSurfaces(out) ? { type: 'surfaces', surfaces: out } : null;
    }
    case 'video':
      return d.blob instanceof Blob ? { type: 'video', blob: d.blob } : null;
    default:
      return null;
  }
}
```

- [ ] **Step 4: Move the two call sites to the new message (single face, old renderer API)**

`src/ui/Editor.tsx`:
1. Add imports: `import { FULL_RECT, type Surface } from '../surfaces/types';`
2. Under the `INITIAL` constant add:
```ts
// Task 3 transitional helper: the app still has exactly one face here.
const toSurfaces = (c: Corners): Surface[] => [{ id: 's1', corners: c, srcRect: FULL_RECT }];
```
3. Replace the three `{ type: 'state', corners: ... }` posts:
   - hello reply and creation broadcast: `ch.postMessage({ type: 'surfaces', surfaces: toSurfaces(cornersRef.current) });`
   - in `onCornersChange`: `channelRef.current?.postMessage({ type: 'surfaces', surfaces: toSurfaces(next) });`

`src/ui/Output.tsx`: replace
```ts
      if (msg.type === 'state') {
        renderer.setCorners(msg.corners);
      } else if (msg.type === 'video') {
```
with
```ts
      if (msg.type === 'surfaces') {
        const first = msg.surfaces[0]; // transitional: the renderer takes one quad until Task 4
        if (first) renderer.setCorners(first.corners);
      } else if (msg.type === 'video') {
```

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run src/output && npx tsc --noEmit && npm test && npm run build`
Expected: all pass.
```bash
git add src/output src/ui/Editor.tsx src/ui/Output.tsx
git commit -m "feat(output): channel carries the validated face list

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Renderer draws a list of faces (both backends)

`Renderer.setSurfaces` replaces `setCorners`. GPU code cannot run in Node, so verification here is `tsc` + build; the pure parts it relies on are tested in Tasks 1-2.

**Files:**
- Modify: `src/renderer/types.ts`, `src/renderer/webgl2.ts` (full replacement), `src/renderer/webgpu.ts` (full replacement), `src/ui/Editor.tsx`, `src/ui/Output.tsx`

**Interfaces:**
- Consumes: `SurfaceSync`, `Surface`, `buildTopology`, `FrameLoop`, `isVideoReady`.
- Produces: `Renderer.setSurfaces(surfaces: Surface[]): void` (replaces `setCorners`).

- [ ] **Step 1: Interface**

`src/renderer/types.ts`:
```ts
import type { Surface } from '../surfaces/types';

export interface Renderer {
  readonly kind: 'webgpu' | 'webgl2';
  /** Called with ms between drawn frames; wire to ThermalGuard. */
  onFrameTime: ((ms: number) => void) | null;
  /** WebGPU only: the GPU device was lost (driver reset, OOM). WebGL2 leaves it undefined. */
  onDeviceLost?: (message: string) => void;
  /**
   * The whole face list, in draw order. Each face shows its own slice of the video. A face
   * with an invalid quad keeps its previous mesh and one with an invalid slice keeps its
   * previous UVs; other faces are unaffected. Faces missing from the list are freed.
   */
  setSurfaces(surfaces: Surface[]): void;
  setVideo(video: HTMLVideoElement | null): void;
  setFpsCap(cap: 30 | 60): void;
  start(): void;
  stop(): void;
  destroy(): void;
}
```

- [ ] **Step 2: Replace `src/renderer/webgl2.ts` with**
```ts
import type { Surface } from '../surfaces/types';
import { buildTopology } from '../warp/mesh';
import { FrameLoop } from './frame-loop';
import { SurfaceSync } from './surface-sync';
import type { Renderer } from './types';
import { isVideoReady } from './video-ready';

const VS = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = a_uv;
}`;

const FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 o_color;
void main() {
  o_color = texture(u_tex, v_uv);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return s;
}

interface GlSurface {
  vao: WebGLVertexArrayObject;
  posBuf: WebGLBuffer;
  uvBuf: WebGLBuffer;
}

export function createWebGL2Renderer(canvas: HTMLCanvasElement): Renderer {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 is not available');

  const program = gl.createProgram()!;
  let vs: WebGLShader | null = null;
  let fs: WebGLShader | null = null;
  try {
    vs = compile(gl, gl.VERTEX_SHADER, VS);
    fs = compile(gl, gl.FRAGMENT_SHADER, FS);
  } catch (e) {
    if (vs) gl.deleteShader(vs); // compile() already deleted the one that failed
    gl.deleteProgram(program);
    throw e;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
  const linkLog = linked ? '' : gl.getProgramInfoLog(program);
  // The linked program keeps what it needs; the shader objects are no longer required.
  gl.detachShader(program, vs);
  gl.detachShader(program, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!linked) {
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${linkLog}`);
  }
  gl.useProgram(program);

  const topo = buildTopology();
  const aPos = gl.getAttribLocation(program, 'a_pos');
  const aUv = gl.getAttribLocation(program, 'a_uv');
  const surfaceBytes = topo.vertexCount * 2 * 4;

  // One index buffer shared by every face; each face's VAO captures it.
  const idxBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, topo.indices, gl.STATIC_DRAW);

  const createSurface = (): GlSurface => {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, surfaceBytes, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const uvBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, surfaceBytes, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bindVertexArray(null);
    return { vao, posBuf, uvBuf };
  };

  const freeSurface = (s: GlSurface) => {
    gl.deleteVertexArray(s.vao);
    gl.deleteBuffer(s.posBuf);
    gl.deleteBuffer(s.uvBuf);
  };

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(gl.getUniformLocation(program, 'u_tex'), 0);

  const sync = new SurfaceSync();
  const surfaces = new Map<string, GlSurface>();
  let order: string[] = [];
  let destroyed = false;
  let video: HTMLVideoElement | null = null;

  const setSurfaces = (list: Surface[]) => {
    if (destroyed) return;
    const r = sync.sync(list);
    for (const id of r.removed) {
      const s = surfaces.get(id);
      if (s) freeSurface(s);
      surfaces.delete(id);
    }
    for (const id of r.created) surfaces.set(id, createSurface());
    for (const id of r.changedPositions) {
      const g = surfaces.get(id);
      const b = sync.buffers(id);
      if (!g || !b) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, g.posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, b.positions);
    }
    for (const id of r.changedUvs) {
      const g = surfaces.get(id);
      const b = sync.buffers(id);
      if (!g || !b) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, g.uvBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, b.uvs);
    }
    order = r.order;
  };

  const draw = () => {
    if (destroyed) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!video || !isVideoReady(video)) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video); // once per frame, shared by all faces
    for (const id of order) {
      const g = surfaces.get(id);
      if (!g) continue;
      gl.bindVertexArray(g.vao);
      gl.drawElements(gl.TRIANGLES, topo.indices.length, gl.UNSIGNED_SHORT, 0);
    }
    gl.bindVertexArray(null);
  };

  const loop = new FrameLoop({ draw, onFrameTime: (ms) => renderer.onFrameTime?.(ms) });

  const renderer: Renderer = {
    kind: 'webgl2',
    onFrameTime: null,
    setSurfaces,
    setVideo: (v) => {
      video = v;
    },
    setFpsCap: (cap) => {
      loop.fpsCap = cap;
    },
    start: () => {
      if (!destroyed) loop.start();
    },
    stop: () => loop.stop(),
    destroy: () => {
      // Deliberately does not lose the context: the canvas may be reused.
      if (destroyed) return;
      destroyed = true;
      loop.stop();
      for (const s of surfaces.values()) freeSurface(s);
      surfaces.clear();
      gl.deleteTexture(tex);
      gl.deleteBuffer(idxBuf);
      gl.deleteProgram(program);
    },
  };
  return renderer;
}
```

- [ ] **Step 3: Replace `src/renderer/webgpu.ts` with**
```ts
import type { Surface } from '../surfaces/types';
import { buildTopology } from '../warp/mesh';
import { FrameLoop } from './frame-loop';
import { SurfaceSync } from './surface-sync';
import type { Renderer } from './types';
import { isVideoReady } from './video-ready';

const WGSL = /* wgsl */ `
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@location(0) p: vec2f, @location(1) uv: vec2f) -> VSOut {
  var o: VSOut;
  o.pos = vec4f(p, 0.0, 1.0);
  o.uv = uv;
  return o;
}

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_external;

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  return textureSampleBaseClampToEdge(tex, samp, in.uv);
}
`;

interface GpuSurface {
  posBuf: GPUBuffer;
  uvBuf: GPUBuffer;
}

export async function createWebGPURenderer(canvas: HTMLCanvasElement): Promise<Renderer> {
  if (!navigator.gpu) throw new Error('WebGPU is not available');
  // Everything that can fail (device, shader, pipeline) happens BEFORE touching
  // the canvas: once getContext('webgpu') has succeeded the canvas can no longer
  // give out a WebGL2 context, so a failure after that point would leave no fallback.
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice();
  let renderer: Renderer | null = null; // assigned below; device.lost may fire any time after
  device.lost.then((info) => {
    console.warn('[hypermapping] WebGPU device lost:', info.message);
    if (info.reason !== 'destroyed') renderer?.onDeviceLost?.(info.message);
  });

  const format = navigator.gpu.getPreferredCanvasFormat(); // needs no canvas
  const topo = buildTopology();
  const surfaceBytes = topo.vertexCount * 2 * 4;
  let pipeline: GPURenderPipeline;
  let sampler: GPUSampler;
  let idxBuf: GPUBuffer;
  let ctx: GPUCanvasContext;
  try {
    const module = device.createShaderModule({ code: WGSL });
    const compile = await module.getCompilationInfo();
    const errors = compile.messages.filter((m) => m.type === 'error');
    if (errors.length) throw new Error(`WGSL compile failed: ${errors.map((m) => m.message).join('; ')}`);

    // The async variant rejects on validation errors instead of failing silently later.
    pipeline = await device.createRenderPipelineAsync({
      layout: 'auto',
      vertex: {
        module,
        entryPoint: 'vs',
        buffers: [
          { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
          { arrayStride: 8, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }] },
        ],
      },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    });
    sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    // One index buffer shared by every face.
    idxBuf = device.createBuffer({
      label: 'warp indices',
      size: topo.indices.byteLength, // 4800 bytes, a multiple of 4
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(idxBuf, 0, topo.indices as Uint16Array<ArrayBuffer>);

    // Only now claim the canvas.
    const c = canvas.getContext('webgpu');
    if (!c) throw new Error('Could not get a WebGPU canvas context');
    c.configure({ device, format, alphaMode: 'opaque' });
    ctx = c;
  } catch (e) {
    device.destroy(); // free the GPU before falling back to WebGL2
    throw e;
  }

  const sync = new SurfaceSync();
  const surfaces = new Map<string, GpuSurface>();
  let order: string[] = [];
  let destroyed = false;
  let video: HTMLVideoElement | null = null;

  const createSurface = (id: string): GpuSurface => ({
    posBuf: device.createBuffer({
      label: `face ${id} positions`,
      size: surfaceBytes,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    }),
    uvBuf: device.createBuffer({
      label: `face ${id} uvs`,
      size: surfaceBytes,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    }),
  });

  const freeSurface = (s: GpuSurface) => {
    s.posBuf.destroy();
    s.uvBuf.destroy();
  };

  const setSurfaces = (list: Surface[]) => {
    if (destroyed) return;
    const r = sync.sync(list);
    for (const id of r.removed) {
      const s = surfaces.get(id);
      if (s) freeSurface(s);
      surfaces.delete(id);
    }
    for (const id of r.created) surfaces.set(id, createSurface(id));
    for (const id of r.changedPositions) {
      const g = surfaces.get(id);
      const b = sync.buffers(id);
      if (g && b) device.queue.writeBuffer(g.posBuf, 0, b.positions);
    }
    for (const id of r.changedUvs) {
      const g = surfaces.get(id);
      const b = sync.buffers(id);
      if (g && b) device.queue.writeBuffer(g.uvBuf, 0, b.uvs);
    }
    order = r.order;
  };

  const draw = () => {
    if (destroyed) return;
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: ctx.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    if (video && isVideoReady(video)) {
      // External textures are valid for one frame, so the bind group is rebuilt each draw
      // (once per frame, shared by all faces).
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: device.importExternalTexture({ source: video }) },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.setIndexBuffer(idxBuf, 'uint16');
      for (const id of order) {
        const g = surfaces.get(id);
        if (!g) continue;
        pass.setVertexBuffer(0, g.posBuf);
        pass.setVertexBuffer(1, g.uvBuf);
        pass.drawIndexed(topo.indices.length);
      }
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
  };

  const loop = new FrameLoop({ draw, onFrameTime: (ms) => renderer?.onFrameTime?.(ms) });

  renderer = {
    kind: 'webgpu',
    onFrameTime: null,
    setSurfaces,
    setVideo: (v) => {
      video = v;
    },
    setFpsCap: (cap) => {
      loop.fpsCap = cap;
    },
    start: () => {
      if (!destroyed) loop.start();
    },
    stop: () => loop.stop(),
    destroy: () => {
      if (destroyed) return;
      destroyed = true; // draw()/start()/setSurfaces() are no-ops from here on
      loop.stop(); // stop the render loop BEFORE anything is torn down
      try {
        for (const s of surfaces.values()) freeSurface(s);
        surfaces.clear();
        idxBuf.destroy();
        ctx.unconfigure();
        device.destroy(); // device.lost then fires with reason 'destroyed' (ignored above)
      } catch (e) {
        console.warn('[hypermapping] WebGPU teardown error:', e);
      }
    },
  };
  return renderer;
}
```

- [ ] **Step 4: Move the call sites to `setSurfaces`**

`src/ui/Editor.tsx`:
- `renderer?.setCorners(cornersRef.current);` → `renderer?.setSurfaces(toSurfaces(cornersRef.current));`
- `renderer?.setCorners(next);` → `renderer?.setSurfaces(toSurfaces(next));`

`src/ui/Output.tsx`: replace the transitional block
```ts
        const first = msg.surfaces[0]; // transitional: the renderer takes one quad until Task 4
        if (first) renderer.setCorners(first.corners);
```
with
```ts
        renderer.setSurfaces(msg.surfaces);
```

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all pass (no GPU unit tests; the pure logic is covered by Tasks 1-2). If `tsc` rejects the `writeBuffer` argument types, cast `b.positions`/`b.uvs` to `Float32Array<ArrayBuffer>` (they already have that type, so this should not be needed) and report it.
```bash
git add src/renderer src/ui/Editor.tsx src/ui/Output.tsx
git commit -m "feat(renderer): draw a list of faces, one video texture per frame

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Editor — several faces, selection, add / delete / reset

**Files:**
- Create: `src/ui/SurfaceBar.tsx`
- Modify (full replacement): `src/ui/PinOverlay.tsx`, `src/ui/Editor.tsx`

**Interfaces:**
- Consumes: Task 1 model (`addSurface`, `removeSurface`, `selectAfterRemove`, `defaultCorners`, `surfaceColor`, `FULL_RECT`), `Renderer.setSurfaces`, `isValidQuad`, `clampCorner`.
- Produces: `<SurfaceBar surfaces selectedId onSelect onAdd onDelete />`; `<PinOverlay surfacesRef selectedId onChange(surfaceId, corners) repaintSignal />`.

UI wiring has no unit tests in this plan; verification is `tsc` + build, then the phone.

- [ ] **Step 1: `src/ui/SurfaceBar.tsx`**
```tsx
import { surfaceColor } from '../surfaces/model';
import { MAX_SURFACES, type Surface } from '../surfaces/types';

interface Props {
  surfaces: Surface[];
  selectedId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: () => void;
}

/** One tab per face (in that face's colour), plus add and delete. */
export function SurfaceBar({ surfaces, selectedId, onSelect, onAdd, onDelete }: Props) {
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      {surfaces.map((s, i) => {
        const selected = s.id === selectedId;
        return (
          <button
            key={s.id}
            className={`rounded-lg px-3 py-2 text-xs font-medium ${selected ? 'text-black' : 'bg-zinc-800 text-white'}`}
            style={{ border: `2px solid ${surfaceColor(i)}`, background: selected ? surfaceColor(i) : undefined }}
            onClick={() => onSelect(s.id)}
          >
            Face {i + 1}
          </button>
        );
      })}
      <button
        className="rounded-lg bg-zinc-700 px-3 py-2 text-xs disabled:opacity-40"
        disabled={surfaces.length >= MAX_SURFACES}
        onClick={onAdd}
      >
        + Face
      </button>
      <button
        className="rounded-lg bg-zinc-700 px-3 py-2 text-xs disabled:opacity-40"
        disabled={surfaces.length <= 1}
        onClick={onDelete}
      >
        Delete
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Replace `src/ui/PinOverlay.tsx` with**
```tsx
import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject, type PointerEvent } from 'react';
import { surfaceColor } from '../surfaces/model';
import type { Surface } from '../surfaces/types';
import { clampCorner } from '../warp/quad';
import type { Corners } from '../warp/types';

const IDS = ['tl', 'tr', 'br', 'bl'] as const;
type CornerId = (typeof IDS)[number];

interface Props {
  surfacesRef: MutableRefObject<Surface[]>;
  selectedId: string;
  /** Return true if the quad was accepted. Rejected moves leave the pin where it was. */
  onChange: (surfaceId: string, next: Corners) => boolean;
  /** Bump to repaint after surfacesRef was changed from outside (e.g. "Reset corners"). */
  repaintSignal?: number;
}

/**
 * Every face's outline, with the four pins of the SELECTED face draggable. Other faces are
 * dim outlines with no pointer targets, so a drag can never grab a pin on the wrong face.
 * Positions are painted by mutating SVG attributes directly: a pointermove never causes a render.
 */
export function PinOverlay({ surfacesRef, selectedId, onChange, repaintSignal }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const circles = useRef<Partial<Record<CornerId, SVGCircleElement | null>>>({});
  const outlines = useRef<Record<string, SVGPolygonElement | null>>({});
  const dragging = useRef<CornerId | null>(null);

  const paint = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    for (const s of surfacesRef.current) {
      const c = s.corners;
      outlines.current[s.id]?.setAttribute(
        'points',
        IDS.map((id) => `${c[id][0] * rect.width},${c[id][1] * rect.height}`).join(' '),
      );
      if (s.id !== selectedId) continue;
      for (const id of IDS) {
        const el = circles.current[id];
        if (!el) continue;
        el.setAttribute('cx', String(c[id][0] * rect.width));
        el.setAttribute('cy', String(c[id][1] * rect.height));
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

  const onDown = (id: CornerId) => (e: PointerEvent<SVGCircleElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = id;
  };

  const onMove = (id: CornerId) => (e: PointerEvent<SVGCircleElement>) => {
    if (dragging.current !== id || !svgRef.current) return;
    const selected = surfacesRef.current.find((s) => s.id === selectedId);
    if (!selected) return;
    const rect = svgRef.current.getBoundingClientRect();
    const p = clampCorner([(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height]);
    const next: Corners = { ...selected.corners, [id]: p };
    if (onChange(selectedId, next)) paint();
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
      {selectedIndex >= 0 &&
        IDS.map((id) => (
          <circle
            key={id}
            ref={(el) => {
              circles.current[id] = el;
            }}
            r={28}
            className="pointer-events-auto cursor-pointer touch-none fill-white/30"
            strokeWidth={3}
            style={{ stroke: selectedColor }}
            onPointerDown={onDown(id)}
            onPointerMove={onMove(id)}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
        ))}
    </svg>
  );
}
```

- [ ] **Step 3: Replace `src/ui/Editor.tsx` with**
```tsx
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { CHANNEL, parseMsg } from '../output/protocol';
import { createVideoFromBlob, type VideoHandle } from '../sources/video';
import { addSurface, defaultCorners, removeSurface, selectAfterRemove } from '../surfaces/model';
import { FULL_RECT, type Surface } from '../surfaces/types';
import { isValidQuad } from '../warp/quad';
import type { Corners } from '../warp/types';
import { PinOverlay } from './PinOverlay';
import { SurfaceBar } from './SurfaceBar';
import { useRenderer } from './useRenderer';
import { useWakeLock } from './wakeLock';

const TAP_TO_START = 'Tap anywhere to start the video';

const INITIAL_SURFACES: Surface[] = [{ id: 's1', corners: defaultCorners(0, 1), srcRect: FULL_RECT }];

export function Editor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { renderer, error, quality } = useRenderer(canvasRef);
  // The face list lives in a ref: pin drags mutate it without re-rendering React.
  const surfacesRef = useRef<Surface[]>(INITIAL_SURFACES);
  const [selectedId, setSelectedId] = useState('s1');
  const [, setVersion] = useState(0); // bumps when the face list or selection changes (never during a drag)
  const [repaint, setRepaint] = useState(0);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const videoRef = useRef<VideoHandle | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const [mode, setMode] = useState<'edit' | 'play'>('edit');
  const [notice, setNotice] = useState<string | null>(null);
  useWakeLock(mode === 'play'); // the detached video gets no playback wake lock of its own

  const bump = () => setVersion((v) => v + 1);

  /** The single place a face list change goes out: ref, renderer, and the output window. */
  const publish = useCallback(
    (list: Surface[]) => {
      surfacesRef.current = list;
      renderer?.setSurfaces(list);
      channelRef.current?.postMessage({ type: 'surfaces', surfaces: list });
    },
    [renderer],
  );

  useEffect(() => {
    renderer?.setSurfaces(surfacesRef.current);
  }, [renderer]);

  // Autoplay can be refused, and backgrounding pauses the video: a paused video
  // would otherwise show its first frame forever. Any tap, or coming back to the
  // page, restarts it.
  const resumeVideo = useCallback(() => {
    const v = videoRef.current?.video;
    if (v?.paused) v.play().catch(() => {});
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') resumeVideo();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [resumeVideo]);

  useEffect(() => {
    const ch = new BroadcastChannel(CHANNEL);
    channelRef.current = ch;
    ch.onmessage = (ev) => {
      if (parseMsg(ev.data)?.type !== 'hello') return;
      // A new output window asked for everything we have.
      ch.postMessage({ type: 'surfaces', surfaces: surfacesRef.current });
      if (blobRef.current) ch.postMessage({ type: 'video', blob: blobRef.current });
    };
    // An output window that was already open (e.g. this editor was reloaded) never sends
    // a new hello, so push our state once now.
    ch.postMessage({ type: 'surfaces', surfaces: surfacesRef.current });
    if (blobRef.current) ch.postMessage({ type: 'video', blob: blobRef.current });
    return () => {
      ch.close();
      channelRef.current = null;
      videoRef.current?.dispose();
    };
  }, []);

  /** A pin move on one face. A bad quad is rejected for that face only. */
  const onCornersChange = useCallback(
    (id: string, next: Corners) => {
      if (!isValidQuad(next)) return false;
      publish(surfacesRef.current.map((s) => (s.id === id ? { ...s, corners: next } : s)));
      return true;
    },
    [publish],
  );

  const resetFace = () => {
    const list = surfacesRef.current;
    const index = list.findIndex((s) => s.id === selectedId);
    if (index < 0) return;
    if (onCornersChange(selectedId, defaultCorners(index, list.length))) setRepaint((n) => n + 1);
  };

  const addFace = () => {
    const next = addSurface(surfacesRef.current);
    if (next === surfacesRef.current) return;
    publish(next);
    setSelectedId(next[next.length - 1].id);
    bump();
  };

  const deleteFace = () => {
    const list = surfacesRef.current;
    const next = removeSurface(list, selectedId);
    if (next === list) return;
    const nextSelected = selectAfterRemove(list, selectedId);
    publish(next);
    setSelectedId(nextSelected);
    bump();
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !renderer) return;
    try {
      const handle = await createVideoFromBlob(file);
      videoRef.current?.dispose();
      videoRef.current = handle;
      blobRef.current = file;
      renderer.setVideo(handle.video);
      channelRef.current?.postMessage({ type: 'video', blob: file });
      if (handle.playing) {
        setNotice(null);
      } else {
        setNotice(TAP_TO_START);
        handle.video.addEventListener('playing', () => setNotice((n) => (n === TAP_TO_START ? null : n)), {
          once: true,
        });
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not load that video');
    }
  };

  // Called from the button's click (a user gesture), which fullscreen requires.
  const enterPlay = () => {
    setMode('play');
    document.documentElement.requestFullscreen?.().catch(() => {});
  };

  // Leaving fullscreen by a system gesture keeps Play mode; only this button leaves it.
  const exitPlay = () => {
    setMode('edit');
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  };

  const openOutput = () => {
    window.open(`${location.pathname}#output`, 'hypermapping-output', 'popup,width=960,height=540');
  };

  return (
    // Capture phase so a tap on a pin or a toolbar button also counts as "tap anywhere".
    <div
      className="fixed inset-0 touch-none select-none overflow-hidden bg-black text-white"
      onPointerDownCapture={resumeVideo}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {mode === 'edit' && (
        <PinOverlay
          surfacesRef={surfacesRef}
          selectedId={selectedId}
          onChange={onCornersChange}
          repaintSignal={repaint}
        />
      )}

      {mode === 'edit' ? (
        <div className="absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center gap-2 bg-black/70 p-3 text-sm backdrop-blur">
          <SurfaceBar
            surfaces={surfacesRef.current}
            selectedId={selectedId}
            onSelect={(id) => {
              setSelectedId(id);
              bump();
            }}
            onAdd={addFace}
            onDelete={deleteFace}
          />
          <label
            className={`rounded-lg px-4 py-3 font-medium ${
              renderer ? 'cursor-pointer bg-cyan-500 text-black' : 'bg-zinc-700 text-zinc-400'
            }`}
          >
            Load video
            <input type="file" accept="video/*" className="hidden" disabled={!renderer} onChange={onFile} />
          </label>
          <button className="rounded-lg bg-zinc-700 px-4 py-3" onClick={enterPlay}>
            Play mode
          </button>
          <button className="rounded-lg bg-zinc-700 px-4 py-3" onClick={resetFace}>
            Reset corners
          </button>
          <button className="rounded-lg bg-zinc-700 px-4 py-3" onClick={openOutput}>
            Open output window
          </button>
          <span className="ml-auto text-xs text-zinc-400">
            {error ?? `${renderer?.kind ?? 'starting…'} · ${Math.round(quality.scale * 100)}% · ${quality.fpsCap}fps`}
          </span>
          {notice && <span className="w-full text-xs text-amber-400">{notice}</span>}
        </div>
      ) : (
        <button
          aria-label="Exit play mode"
          className="absolute left-0 top-0 z-20 h-16 w-16 opacity-0"
          onClick={exitPlay}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all pass. (`Output.tsx` needs no change; it already calls `renderer.setSurfaces(msg.surfaces)` from Task 4.)
```bash
git add src/ui
git commit -m "feat(ui): several faces with selection, add, delete and per-face reset

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Slice editor and README

**Files:**
- Create: `src/ui/SliceEditor.tsx`
- Modify: `src/ui/SurfaceBar.tsx`, `src/ui/Editor.tsx` (edits below), `README.md`

**Interfaces:**
- Consumes: `moveRect`, `resizeRect`, `isValidSrcRect`, `surfaceColor`, `RectCorner` (Task 1), `Editor.publish` (Task 5).
- Produces: `<SliceEditor surfaces selectedId videoAspect onChange(id, rect) onClose />`; `SurfaceBar` gains `sliceMode` and `onToggleSlice`.

- [ ] **Step 1: `src/ui/SliceEditor.tsx`**
```tsx
import { useRef, type PointerEvent } from 'react';
import { moveRect, resizeRect, surfaceColor, type RectCorner } from '../surfaces/model';
import type { SrcRect, Surface } from '../surfaces/types';

interface Props {
  surfaces: Surface[];
  selectedId: string;
  /** Width / height of the loaded video (16/9 until one is loaded). */
  videoAspect: number;
  onChange: (id: string, rect: SrcRect) => void;
  onClose: () => void;
}

const pct = (n: number) => `${n * 100}%`;
const rectStyle = (r: SrcRect) => ({
  left: pct(r.u0),
  top: pct(r.v0),
  width: pct(r.u1 - r.u0),
  height: pct(r.v1 - r.v0),
});

const HANDLES: { corner: RectCorner; style: { left?: string; right?: string; top?: string; bottom?: string } }[] = [
  { corner: 'tl', style: { left: '0%', top: '0%' } },
  { corner: 'tr', style: { left: '100%', top: '0%' } },
  { corner: 'br', style: { left: '100%', top: '100%' } },
  { corner: 'bl', style: { left: '0%', top: '100%' } },
];

/**
 * Pick which part of the video the selected face shows. The big box is the whole video; the
 * selected face's rectangle can be moved (drag the body) or resized (drag a corner).
 * moveRect/resizeRect clamp, so an invalid rectangle can never come out of this component.
 */
export function SliceEditor({ surfaces, selectedId, videoAspect, onChange, onClose }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const move = useRef<{ u: number; v: number; start: SrcRect } | null>(null);
  const resizing = useRef<RectCorner | null>(null);

  const selected = surfaces.find((s) => s.id === selectedId);
  const selectedIndex = surfaces.findIndex((s) => s.id === selectedId);
  const color = surfaceColor(Math.max(0, selectedIndex));

  const toUv = (e: PointerEvent): [number, number] => {
    const r = boxRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  const onBodyDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!selected) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [u, v] = toUv(e);
    move.current = { u, v, start: selected.srcRect };
  };
  const onBodyMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!move.current || !selected) return;
    const [u, v] = toUv(e);
    onChange(selected.id, moveRect(move.current.start, u - move.current.u, v - move.current.v));
  };
  const onBodyUp = (e: PointerEvent<HTMLDivElement>) => {
    move.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onHandleDown = (corner: RectCorner) => (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizing.current = corner;
  };
  const onHandleMove = (corner: RectCorner) => (e: PointerEvent<HTMLDivElement>) => {
    if (resizing.current !== corner || !selected) return;
    const [u, v] = toUv(e);
    onChange(selected.id, resizeRect(selected.srcRect, corner, u, v));
  };
  const onHandleUp = (e: PointerEvent<HTMLDivElement>) => {
    resizing.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/90 p-4">
      <p className="text-xs text-zinc-300">
        Face {Math.max(0, selectedIndex) + 1}: drag the box to move its slice of the video, drag a corner to resize.
      </p>
      <div
        ref={boxRef}
        className="relative touch-none overflow-hidden rounded-md border border-zinc-600 bg-zinc-900"
        style={{ aspectRatio: String(videoAspect), width: `min(92vw, calc(60vh * ${videoAspect}))` }}
      >
        {surfaces.map((s, i) =>
          s.id === selectedId ? null : (
            <div
              key={s.id}
              className="pointer-events-none absolute"
              style={{ ...rectStyle(s.srcRect), border: `2px dashed ${surfaceColor(i)}`, opacity: 0.5 }}
            />
          ),
        )}
        {selected && (
          <div
            className="absolute cursor-move"
            style={{ ...rectStyle(selected.srcRect), border: `3px solid ${color}`, background: `${color}33` }}
            onPointerDown={onBodyDown}
            onPointerMove={onBodyMove}
            onPointerUp={onBodyUp}
            onPointerCancel={onBodyUp}
          >
            {HANDLES.map((h) => (
              <div
                key={h.corner}
                className="absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border-2 bg-white/40"
                style={{ ...h.style, borderColor: color }}
                onPointerDown={onHandleDown(h.corner)}
                onPointerMove={onHandleMove(h.corner)}
                onPointerUp={onHandleUp}
                onPointerCancel={onHandleUp}
              />
            ))}
          </div>
        )}
      </div>
      <button className="rounded-lg bg-cyan-500 px-6 py-3 font-medium text-black" onClick={onClose}>
        Done
      </button>
    </div>
  );
}
```

- [ ] **Step 2: `SurfaceBar` gets the toggle**

In `src/ui/SurfaceBar.tsx` add two props and a button:
```tsx
interface Props {
  surfaces: Surface[];
  selectedId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: () => void;
  onEditSlice: () => void;
}
```
Destructure `onEditSlice` and add, after the Delete button:
```tsx
      <button className="rounded-lg bg-zinc-700 px-3 py-2 text-xs" onClick={onEditSlice}>
        Edit slice
      </button>
```

- [ ] **Step 3: `Editor` shows the slice editor**

In `src/ui/Editor.tsx`:
1. Imports: add `isValidSrcRect` to the model import; add `import { SliceEditor } from './SliceEditor';` and `SrcRect` to the types import (`import { FULL_RECT, type SrcRect, type Surface } from '../surfaces/types';`).
2. State, next to `mode`: `const [sliceMode, setSliceMode] = useState(false);`
3. Add after `deleteFace`:
```tsx
  const onSliceChange = (id: string, rect: SrcRect) => {
    if (!isValidSrcRect(rect)) return;
    publish(surfacesRef.current.map((s) => (s.id === id ? { ...s, srcRect: rect } : s)));
    bump(); // the slice panel is a small tree; re-rendering it per move is fine
  };

  const videoAspect = (() => {
    const v = videoRef.current?.video;
    return v && v.videoWidth > 0 && v.videoHeight > 0 ? v.videoWidth / v.videoHeight : 16 / 9;
  })();
```
4. Pass `onEditSlice={() => setSliceMode(true)}` to `<SurfaceBar ... />`.
5. Immediately after the `{mode === 'edit' ? ( ... ) : ( ... )}` block (still inside the root div), add:
```tsx
      {mode === 'edit' && sliceMode && (
        <SliceEditor
          surfaces={surfacesRef.current}
          selectedId={selectedId}
          videoAspect={videoAspect}
          onChange={onSliceChange}
          onClose={() => setSliceMode(false)}
        />
      )}
```

- [ ] **Step 4: README**

Add a section before "Known limits":
```markdown
## Mapping a box (several faces)

- **+ Face** adds another grid (up to 6). Each face has its own four pins; pick a face with its tab, then drag its pins onto that face of the box. **Delete** removes the selected face, **Reset corners** resets just that face.
- All faces share one video. Each face shows its own **slice** of it, like unfolding the box: **Edit slice** opens a picture of the whole video where you drag the selected face's rectangle (drag the body to move it, a corner to resize it). New faces start as equal strips.
- Play mode and the output window show every face.
```
Also update the first bullet list line "Drag the four pins" to mention "(for the selected face)" if it reads ambiguously.

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all pass; test count is higher than before Task 1.
```bash
git add src/ui README.md
git commit -m "feat(ui): slice editor for choosing what each face shows

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** data model and pure rules (Task 1); `scaleUvs` and per-face CPU UVs (Task 2); renderer `setSurfaces` with per-face buffers, one texture per frame, shared index buffer, per-face freeze on bad quad/slice, immediate buffer release (Tasks 2 + 4); protocol `surfaces` replacing `state` with strict validation (Task 3); SurfaceBar, selected-only pins, per-face Reset, hello/creation broadcast (Task 5); SliceEditor with move/resize via the clamping helpers, Edit slice toggle, README (Task 6). Spec's "Play mode unchanged" holds because `Output`/play wiring is untouched. Spec's "no slice preview image" is respected.

**Placeholder scan:** none; every step carries full code.

**Type consistency:** `Surface`, `SrcRect`, `FULL_RECT`, `MAX_SURFACES`, `MIN_SLICE` (types.ts); `defaultSlices`, `defaultCorners(index,total)`, `addSurface`, `removeSurface`, `selectAfterRemove`, `isValidSrcRect`, `moveRect`, `resizeRect`, `RectCorner`, `isValidSurfaces`, `surfaceColor` (model.ts); `SurfaceSync.sync/buffers`, `SyncResult` fields (`removed, created, changedPositions, changedUvs, order`); `Renderer.setSurfaces`; `Msg.surfaces`; `PinOverlay` props `surfacesRef/selectedId/onChange(id,corners)/repaintSignal`; `SurfaceBar` props — used with the same names in every task that touches them.

**Known risk to watch at execution time:** `Float32Array<ArrayBuffer>` typing between `SurfaceSync` and the `writeBuffer`/`bufferSubData` calls (TypeScript 5.9 is installed, so it should compile; if not, cast at the call site and report it). The empty-list edge: the Editor never produces it, and `SurfaceSync`/backends handle it.
