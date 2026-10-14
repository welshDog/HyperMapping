# HyperMapping Virtual Projector Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A 3D simulator page that projects the app's real output onto a virtual box from a virtual projector, and computes each visible face's four pins from the box size and projector placement so they can be sent to the main app.

**Architecture:** Pure maths (`src/sim/`) turns a box + projector into a camera, projects each front-facing face's corners into the projector image and converts them to the app's unit-space pins. A separate Vite entry (`simulator.html`) renders a three.js scene whose box uses a projective shader fed by the SAME matrices, with the real mapped output drawn by the app's own renderer into a hidden canvas. A new `layout` channel message carries the computed faces to the Editor.

**Tech Stack:** React 18, TypeScript 5.9 (strict), Vite 5, Vitest 2, Tailwind 3, three.js (simulator page only), WebGL2.

**Spec:** `docs/superpowers/specs/2026-10-14-virtual-projector-design.md`

**Staging (Lyndz asked to run one stage at a time; STOP for a checkpoint after each stage):**
1. **Stage 1 — maths** (Tasks 1-2): pure code, fully unit-tested.
2. **Stage 2 — plumbing** (Tasks 3-4): `layout` message + Editor adoption; renderer option; Output refactor (no behaviour change).
3. **Stage 3 — 3D view** (Task 5): simulator page showing the real output projected on a box. Needs a visual check by Lyndz.
4. **Stage 4 — Solve / Send / docs** (Task 6).

## Global Constraints

- Units are metres. The box stands on the floor (y from 0 to `height`), centred on the origin, rotated about Y by `yawDeg`. Projector: `distance` + `azimuthDeg` on the floor from the box centre (azimuth 0 = along +Z), `height` above the floor, aimed at `(0, box.height/2, 0)`.
- `fovY = 2 * atan(1 / (2 * throwRatio * aspect))`. Lens shift `shiftY` is a fraction of image height; `shiftY > 0` moves the image up on the wall, so an on-axis point lands at unit `v = 0.5 + shiftY` (`P[1][2] = 2 * shiftY`).
- Projected points convert to the app's unit space: `u = x/w*0.5 + 0.5`, `v = 0.5 - y/w*0.5`. A point is usable only if `w > 1e-6` (in front of the lens).
- A face is used only if `dot(normal, eye - faceCentre) > 1e-6`. Corners outside `[-0.5, 1.5]` (the pin editor's clamp) skip the face (`off-image`); outside `[0,1]` but inside the clamp keeps it with `partlyOutside`.
- Pin corner order is clockwise `tl, tr, br, bl` (screen, Y down), starting at the top-left-most point. Every solved quad passes `isValidQuad`.
- `toSurfaces`: faces sorted by projected centroid X ascending, ids `s1…sn` (n ≤ `MAX_SURFACES` = 6), slices from `defaultSlices(n)`. An empty result gives `[]` and callers must not send an empty layout.
- `three` is imported ONLY under `src/sim/` (never from the phone app's code), so the main bundle does not grow. `vite.config.ts` builds both entries.
- The simulator's hidden output renderer is forced to WebGL2 with `preserveDrawingBuffer: true`. Texture sampling uses `CanvasTexture` (`flipY` true, default colour space, no colour-space conversion in the shader).
- Existing behaviour must not change: the Output window behaves exactly as before after the `useOutputFeed` refactor; all existing tests stay green and the test count only goes up.
- Lyndz's `sim.html` is not touched. No React.StrictMode.
- Every commit passes `npx tsc --noEmit`, `npm test`, `npm run build`. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never `git add` anything under `.superpowers/`.
- Working directory for every command: `h:\HYPERFOCUSZONE\HperCore\HyperMapping`.

## Review Focus

1. **Never NaN or garbage pins**: a projector inside the box, behind a face, looking along a face normal, or with non-finite inputs must produce skipped faces, not NaN corners. Tested in Task 2.
2. **Corner order and validity**: for any box yaw, every solved quad is clockwise `tl,tr,br,bl`, starts at the top-left-most point, and passes `isValidQuad`. Tested in Task 2.
3. **Lens shift sign**: shift +0.1 moves every corner's `v` by exactly +0.1; an on-axis point lands at `v = 0.5 + shift`. Tested in Tasks 1-2.
4. **`layout` validation and adoption**: a malformed or oversized `layout` is ignored by the Editor; a valid one replaces the face list and selection stays valid. Tested in Task 3 (parser); wiring read in review.
5. **Picture not mirrored, flipped, or disagreeing with the pins**: the simulator shader and the solver use the same matrices (consistency test in Task 2); the visual checkpoint after Task 5 and the end-to-end check in Task 6 confirm orientation.
6. **Output window unchanged** after extracting `useOutputFeed` (Task 4, reviewed by comparing old and new code path by path).

---

## File Structure

```
src/sim/math.ts                 V3/Mat4 helpers, lookAt, perspective (+ math.test.ts)
src/sim/box.ts                  Box, Face, boxFaces (+ box.test.ts)
src/sim/solve.ts                projector camera, projectToUnit, orderClockwise, solveFaces, toSurfaces (+ solve.test.ts)
src/sim/defaults.ts             DEFAULT_BOX, DEFAULT_PROJECTOR (tested via solve.test.ts)
src/sim/describe.ts             human-readable solve summary (+ describe.test.ts)
src/sim/projective-material.ts  three ShaderMaterial projecting a texture from the projector matrices
src/sim/scene.ts                SimScene: three.js scene (floor, box, projector marker, frustum, orbit)
src/sim/SimControls.tsx         sliders
src/sim/SimApp.tsx              page: hidden output renderer + feed + scene + controls + Solve/Send
src/sim/main.tsx                entry
simulator.html                  Vite entry for the simulator
src/ui/useOutputFeed.ts         channel + video + surfaces feed shared by Output and the simulator
src/ui/Output.tsx               uses useOutputFeed (no behaviour change)
src/output/protocol.ts          + 'layout' message (shares the surface-list parser)
src/ui/Editor.tsx               adopts a valid 'layout'
src/renderer/{types,index,webgl2}.ts   RendererOptions { preserveDrawingBuffer }
vite.config.ts                  builds index.html and simulator.html
README.md                       Virtual projector section
```

---

## STAGE 1 — Maths

### Task 1: Vector/matrix helpers and the box

**Files:**
- Create: `src/sim/math.ts`, `src/sim/box.ts`
- Test: `src/sim/math.test.ts`, `src/sim/box.test.ts`

**Interfaces:**
- Produces (`math.ts`): `type V3 = [number, number, number]`; `type Mat4 = number[]` (16, row-major); `sub(a,b): V3`; `dot(a,b): number`; `cross(a,b): V3`; `length(a): number`; `normalize(a): V3` (zero vector → `[0,0,0]`); `lookAt(eye: V3, target: V3, up?: V3): Mat4`; `perspective(fovYRad, aspect, near, far, shiftY?): Mat4`; `mul(a: Mat4, b: Mat4): Mat4`; `transformPoint(m: Mat4, p: V3): [number, number, number, number]`; `toColumnMajor(m: Mat4): Float32Array`.
- Produces (`box.ts`): `interface Box { width: number; height: number; depth: number; yawDeg: number }`; `type FaceId = 'front'|'back'|'left'|'right'|'top'|'bottom'`; `interface Face { id: FaceId; corners: V3[]; normal: V3 }`; `boxFaces(box: Box): Face[]`.

- [ ] **Step 1: Write the failing tests**

`src/sim/math.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { cross, dot, length, lookAt, mul, normalize, perspective, sub, toColumnMajor, transformPoint, type Mat4, type V3 } from './math';

const I: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

describe('vector helpers', () => {
  it('sub, dot, cross and length behave', () => {
    expect(sub([3, 2, 1], [1, 1, 1])).toEqual([2, 1, 0]);
    expect(dot([1, 2, 3], [4, 5, 6])).toBe(32);
    expect(cross([1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(length([3, 4, 0])).toBe(5);
  });
  it('normalize gives a unit vector, and zero for the zero vector', () => {
    expect(length(normalize([3, 4, 12]))).toBeCloseTo(1, 12);
    expect(normalize([0, 0, 0])).toEqual([0, 0, 0]);
  });
});

describe('lookAt', () => {
  it('puts the target straight ahead on -Z at the right distance', () => {
    const v = lookAt([0, 0, 5], [0, 0, 0]);
    const [x, y, z, w] = transformPoint(v, [0, 0, 0]);
    expect([x, y, z, w].map((n) => +n.toFixed(9))).toEqual([0, 0, -5, 1]);
  });
  it('maps world right to camera +X and world up to camera +Y', () => {
    const v = lookAt([0, 0, 5], [0, 0, 0]);
    expect(transformPoint(v, [1, 0, 0])[0]).toBeCloseTo(1, 9);
    expect(transformPoint(v, [0, 1, 0])[1]).toBeCloseTo(1, 9);
  });
  it('is finite when looking straight down', () => {
    const v = lookAt([0, 5, 0], [0, 0, 0]);
    v.forEach((n) => expect(Number.isFinite(n)).toBe(true));
    expect(transformPoint(v, [0, 0, 0])[2]).toBeCloseTo(-5, 9);
  });
});

describe('perspective', () => {
  it('maps the right edge of a 90 degree square frustum to ndc x = 1', () => {
    const p = perspective(Math.PI / 2, 1, 0.1, 100);
    const [x, , , w] = transformPoint(p, [1, 0, -1]);
    expect(x / w).toBeCloseTo(1, 9);
  });
  it('maps the top edge to ndc y = 1 and divides x by the aspect', () => {
    const p = perspective(Math.PI / 2, 2, 0.1, 100);
    const [x, y, , w] = transformPoint(p, [1, 1, -1]);
    expect(y / w).toBeCloseTo(1, 9);
    expect(x / w).toBeCloseTo(0.5, 9);
  });
  it('w equals the distance in front of the camera', () => {
    const p = perspective(1, 1.5, 0.1, 100);
    expect(transformPoint(p, [0, 0, -4])[3]).toBeCloseTo(4, 12);
  });
  it('lens shift moves an on-axis point down in the image by 2*shift in ndc', () => {
    const p = perspective(Math.PI / 2, 1, 0.1, 100, 0.25);
    const [, y, , w] = transformPoint(p, [0, 0, -2]);
    expect(y / w).toBeCloseTo(-0.5, 9);
  });
});

describe('mul and toColumnMajor', () => {
  it('mul with identity is a no-op', () => {
    const v = lookAt([1, 2, 3], [0, 0.5, 0]);
    mul(v, I).forEach((n, i) => expect(n).toBeCloseTo(v[i], 12));
    mul(I, v).forEach((n, i) => expect(n).toBeCloseTo(v[i], 12));
  });
  it('mul(proj, view) equals applying view then proj', () => {
    const v = lookAt([1, 2, 3], [0, 0.5, 0]);
    const p = perspective(1, 1.5, 0.1, 50);
    const pt: V3 = [0.3, 0.4, -0.2];
    const direct = transformPoint(mul(p, v), pt);
    const [x, y, z] = transformPoint(v, pt);
    const step = transformPoint(p, [x, y, z]);
    direct.forEach((n, i) => expect(n).toBeCloseTo(step[i], 9));
  });
  it('toColumnMajor transposes into a Float32Array', () => {
    const m = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    const out = toColumnMajor(m);
    expect(out).toBeInstanceOf(Float32Array);
    expect(Array.from(out)).toEqual([1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15, 4, 8, 12, 16]);
  });
});
```

`src/sim/box.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { boxFaces, type Box } from './box';
import { dot, length, sub, type V3 } from './math';

const BOX: Box = { width: 2, height: 1, depth: 0.5, yawDeg: 0 };
const centre = (b: Box): V3 => [0, b.height / 2, 0];
const faceCentre = (corners: V3[]): V3 =>
  corners.reduce<V3>((a, c) => [a[0] + c[0] / 4, a[1] + c[1] / 4, a[2] + c[2] / 4], [0, 0, 0]);

describe('boxFaces', () => {
  it('returns six faces with the six ids', () => {
    const faces = boxFaces(BOX);
    expect(faces.map((f) => f.id).sort()).toEqual(['back', 'bottom', 'front', 'left', 'right', 'top']);
    faces.forEach((f) => expect(f.corners).toHaveLength(4));
  });

  it('normals are unit length, outward, and every face is planar', () => {
    for (const yawDeg of [0, 30, 90, 137, -45, 180, 300]) {
      const box = { ...BOX, yawDeg };
      for (const f of boxFaces(box)) {
        expect(length(f.normal)).toBeCloseTo(1, 9);
        expect(dot(f.normal, sub(faceCentre(f.corners), centre(box)))).toBeGreaterThan(0);
        const d = f.corners.map((c) => dot(f.normal, c));
        d.forEach((x) => expect(x).toBeCloseTo(d[0], 9));
      }
    }
  });

  it('sizes the faces from the box dimensions', () => {
    const front = boxFaces(BOX).find((f) => f.id === 'front')!;
    const xs = front.corners.map((c) => c[0]);
    const ys = front.corners.map((c) => c[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2, 9);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(1, 9);
    expect(Math.min(...ys)).toBeCloseTo(0, 9); // stands on the floor
    front.corners.forEach((c) => expect(c[2]).toBeCloseTo(0.25, 9));
  });

  it('a 90 degree yaw turns the front face towards +X', () => {
    const front = boxFaces({ ...BOX, yawDeg: 90 }).find((f) => f.id === 'front')!;
    expect(front.normal[0]).toBeCloseTo(1, 9);
    expect(front.normal[2]).toBeCloseTo(0, 9);
  });

  it('all corners stay on the floor or at the top', () => {
    boxFaces({ ...BOX, yawDeg: 33 }).forEach((f) =>
      f.corners.forEach((c) => expect([0, 1].some((y) => Math.abs(c[1] - y) < 1e-9)).toBe(true)),
    );
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/sim`
Expected: FAIL — `./math` / `./box` not found.

- [ ] **Step 3: Implement**

`src/sim/math.ts`:
```ts
export type V3 = [number, number, number];
/** 4x4 matrix, 16 numbers, row-major. */
export type Mat4 = number[];

export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a: V3): V3 => {
  const l = length(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
};

/** View matrix (world -> camera). The camera looks down -Z, like OpenGL. */
export function lookAt(eye: V3, target: V3, up: V3 = [0, 1, 0]): Mat4 {
  const f = normalize(sub(target, eye));
  // Looking straight along `up` would make the right vector zero: use another up.
  const side = length(cross(f, up)) < 1e-9 ? cross(f, [0, 0, 1]) : cross(f, up);
  const s = normalize(side);
  const u = cross(s, f);
  return [
    s[0], s[1], s[2], -dot(s, eye),
    u[0], u[1], u[2], -dot(u, eye),
    -f[0], -f[1], -f[2], dot(f, eye),
    0, 0, 0, 1,
  ];
}

/**
 * OpenGL-style projection. `shiftY` is the lens shift as a fraction of the image height:
 * shiftY > 0 moves the image UP on the wall, so an on-axis point lands lower in the image
 * (ndc y = -2 * shiftY).
 */
export function perspective(fovYRad: number, aspect: number, near: number, far: number, shiftY = 0): Mat4 {
  const t = 1 / Math.tan(fovYRad / 2);
  const nf = 1 / (near - far);
  return [
    t / aspect, 0, 0, 0,
    0, t, 2 * shiftY, 0,
    0, 0, (far + near) * nf, 2 * far * near * nf,
    0, 0, -1, 0,
  ];
}

export function mul(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[r * 4 + k] * b[k * 4 + c];
      out[r * 4 + c] = s;
    }
  }
  return out;
}

/** m * [p, 1] -> [x, y, z, w] (no perspective divide). */
export function transformPoint(m: Mat4, p: V3): [number, number, number, number] {
  const row = (r: number) => m[r * 4] * p[0] + m[r * 4 + 1] * p[1] + m[r * 4 + 2] * p[2] + m[r * 4 + 3];
  return [row(0), row(1), row(2), row(3)];
}

/** The same matrix as column-major float32 data, the layout GPUs and three.js expect. */
export function toColumnMajor(m: Mat4): Float32Array {
  const out = new Float32Array(16);
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out[c * 4 + r] = m[r * 4 + c];
  return out;
}
```

`src/sim/box.ts`:
```ts
import type { V3 } from './math';

/** A box standing on the floor (y from 0 to height), centred on the origin, rotated about Y. */
export interface Box {
  width: number;
  height: number;
  depth: number;
  yawDeg: number;
}

export type FaceId = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export interface Face {
  id: FaceId;
  /** Four corners in world space. */
  corners: V3[];
  /** Outward unit normal in world space. */
  normal: V3;
}

export function boxFaces(box: Box): Face[] {
  const hw = box.width / 2;
  const hd = box.depth / 2;
  const h = box.height;
  const yaw = (box.yawDeg * Math.PI) / 180;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // Rotation about +Y (same as three.js rotation.y): +Z turns towards +X.
  const rot = ([x, y, z]: V3): V3 => [c * x + s * z, y, -s * x + c * z];

  const defs: { id: FaceId; normal: V3; corners: V3[] }[] = [
    { id: 'front', normal: [0, 0, 1], corners: [[-hw, h, hd], [hw, h, hd], [hw, 0, hd], [-hw, 0, hd]] },
    { id: 'back', normal: [0, 0, -1], corners: [[hw, h, -hd], [-hw, h, -hd], [-hw, 0, -hd], [hw, 0, -hd]] },
    { id: 'right', normal: [1, 0, 0], corners: [[hw, h, hd], [hw, h, -hd], [hw, 0, -hd], [hw, 0, hd]] },
    { id: 'left', normal: [-1, 0, 0], corners: [[-hw, h, -hd], [-hw, h, hd], [-hw, 0, hd], [-hw, 0, -hd]] },
    { id: 'top', normal: [0, 1, 0], corners: [[-hw, h, -hd], [hw, h, -hd], [hw, h, hd], [-hw, h, hd]] },
    { id: 'bottom', normal: [0, -1, 0], corners: [[-hw, 0, hd], [hw, 0, hd], [hw, 0, -hd], [-hw, 0, -hd]] },
  ];
  return defs.map((d) => ({ id: d.id, normal: rot(d.normal), corners: d.corners.map(rot) }));
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/sim && npx tsc --noEmit`
Expected: PASS; no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/sim
git commit -m "feat(sim): vector/matrix helpers and box geometry

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Projector camera and face solver

**Files:**
- Create: `src/sim/solve.ts`, `src/sim/defaults.ts`
- Test: `src/sim/solve.test.ts`

**Interfaces:**
- Consumes: `lookAt, perspective, mul, transformPoint, dot, sub, V3, Mat4` (math); `Box, FaceId, boxFaces` (box); `defaultSlices`, `isValidQuad`, `Corners`, `Vec2`, `Surface`, `MAX_SURFACES`.
- Produces: `interface Projector { distance; azimuthDeg; height; throwRatio; aspect; shiftY }`; `interface ProjectorCamera { eye: V3; view: Mat4; proj: Mat4; viewProj: Mat4 }`; `const PROJECTOR_NEAR = 0.05`, `PROJECTOR_FAR = 100`; `projectorCamera(p, box): ProjectorCamera`; `projectToUnit(viewProj, p): Vec2 | null`; `orderClockwise(points: Vec2[]): Corners`; `type SkipReason = 'facing-away'|'behind-projector'|'off-image'|'degenerate'` (`degenerate` = edge-on or too small: the quad would fail `isValidQuad`; added after Task 2 review); `interface SolvedFace { face: FaceId; corners: Corners; centroidX: number; partlyOutside: boolean }`; `interface SolveResult { faces: SolvedFace[]; skipped: { face: FaceId; reason: SkipReason }[] }`; `solveFaces(box, projector): SolveResult`; `toSurfaces(result): Surface[]`; (`defaults.ts`) `DEFAULT_BOX`, `DEFAULT_PROJECTOR`.

- [ ] **Step 1: Write the failing tests**

`src/sim/solve.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isValidQuad } from '../warp/quad';
import { isValidSurfaces } from '../surfaces/model';
import type { Vec2 } from '../warp/types';
import type { Box } from './box';
import { DEFAULT_BOX, DEFAULT_PROJECTOR } from './defaults';
import { toColumnMajor, type V3 } from './math';
import { orderClockwise, projectToUnit, projectorCamera, solveFaces, toSurfaces, type Projector } from './solve';

const CUBE: Box = { width: 1, height: 1, depth: 1, yawDeg: 0 };
// Level with the box centre, straight in front of its +Z face.
const FRONT_ON: Projector = { distance: 3, azimuthDeg: 0, height: 0.5, throwRatio: 1.2, aspect: 16 / 9, shiftY: 0 };
const CORNER_VIEW: Projector = { distance: 3, azimuthDeg: 35, height: 2, throwRatio: 0.9, aspect: 16 / 9, shiftY: 0 };

const area = (c: { tl: Vec2; tr: Vec2; br: Vec2; bl: Vec2 }) => {
  const p = [c.tl, c.tr, c.br, c.bl];
  let a = 0;
  for (let i = 0; i < 4; i++) a += p[i][0] * p[(i + 1) % 4][1] - p[(i + 1) % 4][0] * p[i][1];
  return a / 2;
};

describe('orderClockwise', () => {
  it('orders shuffled points clockwise from the top-left-most', () => {
    const c = orderClockwise([[0.7, 0.8], [0.3, 0.2], [0.8, 0.25], [0.2, 0.75]]);
    expect(c.tl).toEqual([0.3, 0.2]);
    expect(c.tr).toEqual([0.8, 0.25]);
    expect(c.br).toEqual([0.7, 0.8]);
    expect(c.bl).toEqual([0.2, 0.75]);
  });
});

describe('projectToUnit', () => {
  it('the point the projector aims at lands at the image centre', () => {
    const cam = projectorCamera(FRONT_ON, CUBE);
    const [u, v] = projectToUnit(cam.viewProj, [0, 0.5, 0])!;
    expect(u).toBeCloseTo(0.5, 9);
    expect(v).toBeCloseTo(0.5, 9);
  });
  it('lens shift moves the aim point to v = 0.5 + shift', () => {
    const cam = projectorCamera({ ...FRONT_ON, shiftY: 0.1 }, CUBE);
    expect(projectToUnit(cam.viewProj, [0, 0.5, 0])![1]).toBeCloseTo(0.6, 9);
  });
  it('returns null for a point behind the lens', () => {
    const cam = projectorCamera(FRONT_ON, CUBE);
    expect(projectToUnit(cam.viewProj, [0, 0.5, 10])).toBeNull();
  });
  it('the GPU path (column-major float32 data) agrees with projectToUnit', () => {
    const cam = projectorCamera(CORNER_VIEW, CUBE);
    const m = toColumnMajor(cam.viewProj);
    const p: V3 = [0.4, 0.7, 0.5];
    const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12];
    const y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13];
    const w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
    const u = projectToUnit(cam.viewProj, p)!;
    expect((x / w) * 0.5 + 0.5).toBeCloseTo(u[0], 4);
    expect(0.5 - (y / w) * 0.5).toBeCloseTo(u[1], 4);
  });
});

describe('solveFaces', () => {
  it('front-on: only the front face is visible, symmetric about the image centre', () => {
    const r = solveFaces(CUBE, FRONT_ON);
    expect(r.faces.map((f) => f.face)).toEqual(['front']);
    expect(r.skipped).toHaveLength(5);
    expect(r.skipped.every((s) => s.reason === 'facing-away')).toBe(true);
    const c = r.faces[0].corners;
    expect(c.tl[0] + c.tr[0]).toBeCloseTo(1, 9);
    expect(c.tl[1] + c.bl[1]).toBeCloseTo(1, 9);
    expect(c.tl[0]).toBeCloseTo(c.bl[0], 9);
    expect(c.tl[0]).toBeCloseTo(0.26, 2); // analytic: 0.5 - 0.5 * 0.5 / (2.5 * tan(fov/2) * aspect)
    expect(c.tl[1]).toBeCloseTo(0.0733, 3);
    expect(r.faces[0].partlyOutside).toBe(false);
  });

  it('from an elevated corner it sees three faces', () => {
    const r = solveFaces(CUBE, CORNER_VIEW);
    expect(r.faces.map((f) => f.face).sort()).toEqual(['front', 'right', 'top']);
    expect(r.skipped).toHaveLength(3);
    r.faces.forEach((f) => expect(isValidQuad(f.corners)).toBe(true));
  });

  it('the default setup is a good starting point: three faces, nothing off-image', () => {
    const r = solveFaces(DEFAULT_BOX, DEFAULT_PROJECTOR);
    expect(r.faces).toHaveLength(3);
    expect(r.skipped.every((s) => s.reason === 'facing-away')).toBe(true);
  });

  it('a projector inside the box sees no faces and produces no garbage', () => {
    const r = solveFaces(CUBE, { ...FRONT_ON, distance: 0 });
    expect(r.faces).toEqual([]);
    expect(r.skipped).toHaveLength(6);
  });

  it('a face passing beside the projector is skipped as behind-projector', () => {
    const box: Box = { width: 1, height: 0.4, depth: 10, yawDeg: 0 };
    const r = solveFaces(box, { ...FRONT_ON, height: 1, distance: 3 });
    expect(r.skipped).toContainEqual({ face: 'top', reason: 'behind-projector' });
  });

  it('a zoomed-in projector skips faces that fall far outside the image', () => {
    const r = solveFaces(CUBE, { ...FRONT_ON, throwRatio: 4 });
    expect(r.faces).toEqual([]);
    expect(r.skipped).toContainEqual({ face: 'front', reason: 'off-image' });
  });

  it('a face slightly outside the image is kept and flagged partlyOutside', () => {
    const r = solveFaces(CUBE, { ...FRONT_ON, throwRatio: 1.875 });
    expect(r.faces).toHaveLength(1);
    expect(r.faces[0].partlyOutside).toBe(true);
    expect(r.faces[0].corners.tl[1]).toBeLessThan(0);
    expect(r.faces[0].corners.tl[1]).toBeGreaterThan(-0.5);
  });

  it('lens shift moves every corner down by exactly the shift', () => {
    const a = solveFaces(CUBE, FRONT_ON).faces[0].corners;
    const b = solveFaces(CUBE, { ...FRONT_ON, shiftY: 0.1 }).faces[0].corners;
    for (const k of ['tl', 'tr', 'br', 'bl'] as const) {
      expect(b[k][1] - a[k][1]).toBeCloseTo(0.1, 9);
      expect(b[k][0]).toBeCloseTo(a[k][0], 9);
    }
  });

  it('non-finite inputs never produce non-finite pins', () => {
    const r = solveFaces(CUBE, { ...FRONT_ON, distance: NaN });
    expect(r.faces).toEqual([]);
    const r2 = solveFaces({ ...CUBE, yawDeg: NaN }, FRONT_ON);
    r2.faces.forEach((f) => [f.corners.tl, f.corners.tr, f.corners.br, f.corners.bl].forEach((p) => p.forEach((n) => expect(Number.isFinite(n)).toBe(true))));
  });

  it('every quad is valid, clockwise, starts top-left, for any box yaw', () => {
    for (let yawDeg = 0; yawDeg < 360; yawDeg += 20) {
      const r = solveFaces({ ...CUBE, yawDeg }, CORNER_VIEW);
      expect(r.faces.length + r.skipped.length).toBe(6);
      expect(r.faces.length).toBeGreaterThanOrEqual(2);
      for (const f of r.faces) {
        const pts = [f.corners.tl, f.corners.tr, f.corners.br, f.corners.bl];
        expect(isValidQuad(f.corners)).toBe(true);
        expect(area(f.corners)).toBeGreaterThan(0);
        const sums = pts.map((p) => p[0] + p[1]);
        expect(sums[0]).toBeCloseTo(Math.min(...sums), 12);
        pts.forEach((p) => p.forEach((n) => expect(Number.isFinite(n)).toBe(true)));
      }
    }
  });
});

describe('toSurfaces', () => {
  it('turns the faces into app surfaces ordered left to right with equal slices', () => {
    const s = toSurfaces(solveFaces(CUBE, CORNER_VIEW));
    expect(s.map((x) => x.id)).toEqual(['s1', 's2', 's3']);
    expect(isValidSurfaces(s)).toBe(true);
    for (let i = 0; i < 3; i++) {
      expect(s[i].srcRect.u0).toBeCloseTo(i / 3, 12);
      expect(s[i].srcRect.u1).toBeCloseTo((i + 1) / 3, 12);
    }
    const cx = s.map((x) => (x.corners.tl[0] + x.corners.tr[0] + x.corners.br[0] + x.corners.bl[0]) / 4);
    expect(cx[0]).toBeLessThanOrEqual(cx[1]);
    expect(cx[1]).toBeLessThanOrEqual(cx[2]);
  });
  it('an empty result gives an empty list', () => {
    expect(toSurfaces({ faces: [], skipped: [] })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/sim/solve.test.ts`
Expected: FAIL — `./solve` / `./defaults` not found.

- [ ] **Step 3: Implement**

`src/sim/defaults.ts`:
```ts
import type { Box } from './box';
import type { Projector } from './solve';

/** A 1 m cube on the floor, projector 3 m away, a little to the side and above it. */
export const DEFAULT_BOX: Box = { width: 1, height: 1, depth: 1, yawDeg: 0 };
export const DEFAULT_PROJECTOR: Projector = {
  distance: 3,
  azimuthDeg: 25,
  height: 1.5,
  throwRatio: 1.2,
  aspect: 16 / 9,
  shiftY: 0,
};
```

`src/sim/solve.ts`:
```ts
import { defaultSlices } from '../surfaces/model';
import { MAX_SURFACES, type Surface } from '../surfaces/types';
import type { Corners, Vec2 } from '../warp/types';
import { boxFaces, type Box, type FaceId } from './box';
import { dot, lookAt, mul, perspective, sub, transformPoint, type Mat4, type V3 } from './math';

/** Floor position (distance + azimuth from the box centre), lens height, and lens/image settings. */
export interface Projector {
  distance: number;
  /** Degrees on the floor from the box centre; 0 = along +Z. */
  azimuthDeg: number;
  height: number;
  /** Throw distance / image width. */
  throwRatio: number;
  /** Image width / height (16/9 by default). */
  aspect: number;
  /** Lens shift as a fraction of image height; positive moves the image up. */
  shiftY: number;
}

export interface ProjectorCamera {
  eye: V3;
  view: Mat4;
  proj: Mat4;
  viewProj: Mat4;
}

export const PROJECTOR_NEAR = 0.05;
export const PROJECTOR_FAR = 100;

export function projectorCamera(p: Projector, box: Box): ProjectorCamera {
  const az = (p.azimuthDeg * Math.PI) / 180;
  const eye: V3 = [p.distance * Math.sin(az), p.height, p.distance * Math.cos(az)];
  const target: V3 = [0, box.height / 2, 0];
  const fovY = 2 * Math.atan(1 / (2 * p.throwRatio * p.aspect));
  const view = lookAt(eye, target);
  const proj = perspective(fovY, p.aspect, PROJECTOR_NEAR, PROJECTOR_FAR, p.shiftY);
  return { eye, view, proj, viewProj: mul(proj, view) };
}

/** World point -> the app's unit space (0..1, Y down), or null if it is behind the lens. */
export function projectToUnit(viewProj: Mat4, p: V3): Vec2 | null {
  const [x, y, , w] = transformPoint(viewProj, p);
  if (!(w > 1e-6)) return null; // also rejects NaN
  return [(x / w) * 0.5 + 0.5, 0.5 - (y / w) * 0.5];
}

/** Four points of a convex quad -> clockwise tl, tr, br, bl (screen, Y down), starting at the top-left-most. */
export function orderClockwise(points: Vec2[]): Corners {
  const cx = points.reduce((a, p) => a + p[0], 0) / points.length;
  const cy = points.reduce((a, p) => a + p[1], 0) / points.length;
  // With Y down, increasing atan2 angle runs clockwise on screen.
  const sorted = [...points].sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let start = 0;
  let best = Infinity;
  sorted.forEach((p, i) => {
    const k = p[0] + p[1];
    if (k < best) {
      best = k;
      start = i;
    }
  });
  const o = [0, 1, 2, 3].map((i) => sorted[(start + i) % 4]);
  return { tl: o[0], tr: o[1], br: o[2], bl: o[3] };
}

export type SkipReason = 'facing-away' | 'behind-projector' | 'off-image';

export interface SolvedFace {
  face: FaceId;
  corners: Corners;
  centroidX: number;
  partlyOutside: boolean;
}

export interface SolveResult {
  faces: SolvedFace[];
  skipped: { face: FaceId; reason: SkipReason }[];
}

/** The pin editor clamps pins to this range, so a face beyond it cannot be represented. */
const CLAMP_MIN = -0.5;
const CLAMP_MAX = 1.5;

export function solveFaces(box: Box, projector: Projector): SolveResult {
  const cam = projectorCamera(projector, box);
  const result: SolveResult = { faces: [], skipped: [] };
  for (const face of boxFaces(box)) {
    const centre = face.corners.reduce<V3>((a, c) => [a[0] + c[0] / 4, a[1] + c[1] / 4, a[2] + c[2] / 4], [0, 0, 0]);
    // A box is convex, so every front-facing face is fully visible.
    if (!(dot(face.normal, sub(cam.eye, centre)) > 1e-6)) {
      result.skipped.push({ face: face.id, reason: 'facing-away' });
      continue;
    }
    const pts: Vec2[] = [];
    let behind = false;
    for (const c of face.corners) {
      const u = projectToUnit(cam.viewProj, c);
      if (!u) {
        behind = true;
        break;
      }
      pts.push(u);
    }
    if (behind) {
      result.skipped.push({ face: face.id, reason: 'behind-projector' });
      continue;
    }
    if (pts.some(([u, v]) => !(u >= CLAMP_MIN && u <= CLAMP_MAX && v >= CLAMP_MIN && v <= CLAMP_MAX))) {
      result.skipped.push({ face: face.id, reason: 'off-image' });
      continue;
    }
    result.faces.push({
      face: face.id,
      corners: orderClockwise(pts),
      centroidX: pts.reduce((a, p) => a + p[0], 0) / 4,
      partlyOutside: pts.some(([u, v]) => u < 0 || u > 1 || v < 0 || v > 1),
    });
  }
  return result;
}

/** App faces from a solve: left to right, ids s1..sn, equal slices so the video runs across the box. */
export function toSurfaces(result: SolveResult): Surface[] {
  const sorted = [...result.faces].sort((a, b) => a.centroidX - b.centroidX).slice(0, MAX_SURFACES);
  const slices = defaultSlices(sorted.length);
  return sorted.map((f, i) => ({ id: `s${i + 1}`, corners: f.corners, srcRect: slices[i] }));
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run src/sim && npx tsc --noEmit && npm test`
Expected: PASS everywhere. If an analytic number in the front-on test is off by more than the stated precision, recompute it from the formula in the comment before touching the implementation, and report exactly what you changed and why.

- [ ] **Step 5: Commit**

```bash
git add src/sim
git commit -m "feat(sim): projector camera and face solver

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

> **CHECKPOINT — end of Stage 1.** Stop here and report to Lyndz (the maths is done and fully unit-tested; nothing is visible yet). Continue to Stage 2 only when asked.

---

## STAGE 2 — Plumbing

### Task 3: `layout` message and Editor adoption

**Files:**
- Modify (full replacement): `src/output/protocol.ts`
- Modify: `src/output/protocol.test.ts`, `src/ui/Editor.tsx`

**Interfaces:**
- Consumes: `Surface`, `MAX_SURFACES`, `isValidSurfaces`.
- Produces: `Msg` gains `{ type: 'layout'; surfaces: Surface[] }`; `parseMsg` validates it with exactly the same rules as `surfaces`.

- [ ] **Step 1: Write the failing tests**

Add inside the existing `describe('parseMsg', ...)` in `src/output/protocol.test.ts` (it already defines `corners`, `rect`, `surface`):
```ts
  it('accepts a well-formed layout message', () => {
    const msg = { type: 'layout', surfaces: [surface('s1'), surface('s2')] };
    expect(parseMsg(msg)).toEqual(msg);
  });
  it('rejects a layout message for every case surfaces rejects', () => {
    const bad = (surfaces: unknown) => parseMsg({ type: 'layout', surfaces });
    expect(bad([])).toBeNull();
    expect(bad('nope')).toBeNull();
    expect(bad(undefined)).toBeNull();
    expect(bad(Array.from({ length: 7 }, (_, i) => surface('s' + (i + 1))))).toBeNull();
    expect(bad([surface('a'), surface('a')])).toBeNull();
    expect(bad([surface('a', { corners: { ...corners, tl: [NaN, 0] } })])).toBeNull();
    expect(bad([surface('a', { srcRect: { u0: 0.5, v0: 0, u1: 0.5, v1: 1 } })])).toBeNull();
    expect(bad([null])).toBeNull();
  });
  it('strips unknown fields from a layout message', () => {
    const out = parseMsg({ type: 'layout', surfaces: [surface('s1', { evil: 1 })], extra: true });
    expect(out).toEqual({ type: 'layout', surfaces: [surface('s1')] });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/output`
Expected: FAIL — `layout` returns `null`.

- [ ] **Step 3: Implement the protocol (full replacement of `src/output/protocol.ts`)**
```ts
import { isValidSurfaces } from '../surfaces/model';
import { MAX_SURFACES, type Surface } from '../surfaces/types';
import type { Vec2 } from '../warp/types';

export const CHANNEL = 'hypermapping';

export type Msg =
  | { type: 'hello' } // output window -> editor: "send me everything you have"
  | { type: 'surfaces'; surfaces: Surface[] } // editor -> output: the whole face list
  | { type: 'layout'; surfaces: Surface[] } // simulator -> editor: "use this face layout"
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

/** A whole face list (used by both `surfaces` and `layout`). Null if anything is wrong. */
function parseSurfaceList(raw: unknown): Surface[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_SURFACES) return null;
  const out: Surface[] = [];
  for (const item of raw) {
    const s = parseSurface(item);
    if (!s) return null;
    out.push(s);
  }
  return isValidSurfaces(out) ? out : null;
}

/** Validate anything that arrives on the channel; never trust the wire. */
export function parseMsg(data: unknown): Msg | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  switch (d.type) {
    case 'hello':
      return { type: 'hello' };
    case 'surfaces':
    case 'layout': {
      const surfaces = parseSurfaceList(d.surfaces);
      return surfaces ? { type: d.type, surfaces } : null;
    }
    case 'video':
      return d.blob instanceof Blob ? { type: 'video', blob: d.blob } : null;
    default:
      return null;
  }
}
```

- [ ] **Step 4: Editor adopts a valid `layout` (`src/ui/Editor.tsx`)**

1. Next to the other refs add: `const adoptLayoutRef = useRef<(list: Surface[]) => void>(() => {});`
2. Immediately after the `deleteFace` function add:
```tsx
  // The simulator computed a face layout: replace the face list, select the first face.
  // Stored in a ref because the channel effect below runs once and must see the latest `publish`.
  adoptLayoutRef.current = (list: Surface[]) => {
    publish(list);
    setSelectedId(list[0].id);
    setRepaint((n) => n + 1);
    bump();
  };
```
3. In the channel effect replace
```ts
    ch.onmessage = (ev) => {
      if (parseMsg(ev.data)?.type !== 'hello') return;
```
with
```ts
    ch.onmessage = (ev) => {
      const msg = parseMsg(ev.data);
      if (msg?.type === 'layout') {
        adoptLayoutRef.current(msg.surfaces);
        return;
      }
      if (msg?.type !== 'hello') return;
```
(`Output.tsx` already ignores unknown message types, so `layout` needs no change there.)

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run src/output && npx tsc --noEmit && npm test && npm run build`
Expected: all pass. The Editor change has no unit test (DOM); say so in the report.
```bash
git add src/output src/ui/Editor.tsx
git commit -m "feat(output): layout message; the Editor adopts a valid layout

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Renderer option and `useOutputFeed` extraction

**Files:**
- Create: `src/ui/useOutputFeed.ts`
- Modify: `src/renderer/types.ts`, `src/renderer/index.ts`, `src/renderer/webgl2.ts`, `src/ui/Output.tsx` (full replacement)

**Interfaces:**
- Produces: `interface RendererOptions { preserveDrawingBuffer?: boolean }` (`types.ts`, re-exported from `renderer/index.ts`); `createRenderer(canvas, forced?, options?)`; `createWebGL2Renderer(canvas, options?)`; `useOutputFeed(renderer: Renderer | null, onSurfaces?: (surfaces: Surface[]) => void): { resumeVideo: () => void }`.

No unit tests exist for this DOM/GPU code. The point of this task is **no behaviour change** for the Output window; the reviewer will compare old and new paths.

- [ ] **Step 1: Renderer option**

`src/renderer/types.ts` — add (and keep everything else):
```ts
/** Options a caller may pass when creating a renderer. */
export interface RendererOptions {
  /**
   * WebGL2 only (WebGPU ignores it): keep the drawn picture readable after the frame, so another
   * context (e.g. the simulator's three.js view) can sample the canvas at any time.
   */
  preserveDrawingBuffer?: boolean;
}
```

`src/renderer/webgl2.ts` — import the type and use it:
```ts
import type { Renderer, RendererOptions } from './types';
...
export function createWebGL2Renderer(canvas: HTMLCanvasElement, options: RendererOptions = {}): Renderer {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
  });
```

`src/renderer/index.ts`:
```ts
import { chooseBackends } from './backends';
import type { Renderer, RendererOptions } from './types';
import { createWebGL2Renderer } from './webgl2';
import { createWebGPURenderer } from './webgpu';

export type { Renderer, RendererOptions } from './types';
export { ThermalGuard, type Quality } from './quality';
export { computeBackingSize } from './fit';

/**
 * Pick the best backend. `?renderer=webgl2` or `?renderer=webgpu` in the URL
 * forces exactly one (failures are then visible instead of silently falling back).
 */
export async function createRenderer(
  canvas: HTMLCanvasElement,
  forced: string | null = new URLSearchParams(location.search).get('renderer'),
  options: RendererOptions = {},
): Promise<Renderer> {
  const order = chooseBackends({ forced, hasWebGPU: 'gpu' in navigator });
  const errors: string[] = [];
  for (const backend of order) {
    try {
      return backend === 'webgpu' ? await createWebGPURenderer(canvas) : createWebGL2Renderer(canvas, options);
    } catch (e) {
      console.warn(`[hypermapping] ${backend} failed`, e);
      errors.push(`${backend}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`No usable graphics backend (${errors.join('; ')})`);
}
```

- [ ] **Step 2: `src/ui/useOutputFeed.ts`**
```ts
import { useCallback, useEffect, useRef } from 'react';
import { CHANNEL, parseMsg } from '../output/protocol';
import type { Renderer } from '../renderer';
import { createVideoFromBlob, type VideoHandle } from '../sources/video';
import type { Surface } from '../surfaces/types';

/**
 * Connects a renderer to the editor over the channel, exactly like the Output window always did:
 * says `hello`, applies the face lists it receives and plays the video it receives. If `onSurfaces`
 * is given it is called INSTEAD of `renderer.setSurfaces` (the simulator uses this to ignore the
 * app's faces while it shows its own layout).
 */
export function useOutputFeed(renderer: Renderer | null, onSurfaces?: (surfaces: Surface[]) => void) {
  const handleRef = useRef<VideoHandle | null>(null);
  const onSurfacesRef = useRef(onSurfaces);
  onSurfacesRef.current = onSurfaces;

  // A refused autoplay or a backgrounded tab leaves the video paused on one frame.
  const resumeVideo = useCallback(() => {
    const v = handleRef.current?.video;
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
    if (!renderer) return;
    const ch = new BroadcastChannel(CHANNEL);
    let latest = 0; // guards against out-of-order async video loads

    ch.onmessage = async (ev) => {
      const msg = parseMsg(ev.data);
      if (!msg) return;
      if (msg.type === 'surfaces') {
        if (onSurfacesRef.current) onSurfacesRef.current(msg.surfaces);
        else renderer.setSurfaces(msg.surfaces);
      } else if (msg.type === 'video') {
        const mine = ++latest;
        try {
          const next = await createVideoFromBlob(msg.blob);
          if (mine !== latest) {
            next.dispose();
            return;
          }
          try {
            renderer.setVideo(next.video);
          } catch (e) {
            next.dispose(); // never leak a video the renderer refused
            throw e;
          }
          // Swap only after the renderer holds the new video, so it never draws a disposed one.
          handleRef.current?.dispose();
          handleRef.current = next;
        } catch (e) {
          console.warn('[hypermapping] output could not load video', e);
        }
      }
    };
    ch.postMessage({ type: 'hello' });

    return () => {
      ch.close();
      latest++; // a load still in flight is now stale: it disposes itself instead of being assigned
      handleRef.current?.dispose();
      handleRef.current = null;
      renderer.setVideo(null);
    };
  }, [renderer]);

  return { resumeVideo };
}
```

- [ ] **Step 3: Replace `src/ui/Output.tsx` with**
```tsx
import { useRef } from 'react';
import { useOutputFeed } from './useOutputFeed';
import { useRenderer } from './useRenderer';
import { useWakeLock } from './wakeLock';

/** Projector view: nothing but the warped video. Click once to go fullscreen. */
export function Output() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { renderer, error } = useRenderer(canvasRef);
  useWakeLock(true); // a projector screen must never dim
  const { resumeVideo } = useOutputFeed(renderer);

  return (
    <div
      className="fixed inset-0 cursor-none bg-black"
      onPointerDown={resumeVideo}
      onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
      {error && <p className="absolute left-4 top-4 text-sm text-amber-400">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all pass, test count unchanged. State in the report that this task has no unit tests and was verified by tsc/build plus a path-by-path comparison with the old `Output.tsx` (hello after `onmessage` is assigned, `latest` guard, late-load disposal, cleanup order, visibilitychange resume, pointer-down resume, fullscreen on click).
```bash
git add src
git commit -m "refactor: share the output feed hook; add preserveDrawingBuffer renderer option

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

> **CHECKPOINT — end of Stage 2.** Stop and report to Lyndz (no visible change: the app should behave exactly as before; ask Lyndz to confirm the Output window still works if convenient). Continue to Stage 3 only when asked.

---

## STAGE 3 — The 3D view

### Task 5: Simulator page showing the real output projected on a box

**Files:**
- Modify: `package.json` (+ lockfile), `vite.config.ts`
- Create: `simulator.html`, `src/sim/main.tsx`, `src/sim/projective-material.ts`, `src/sim/scene.ts`, `src/sim/SimControls.tsx`, `src/sim/SimApp.tsx`

**Interfaces:**
- Consumes: `projectorCamera`, `PROJECTOR_NEAR/FAR`, `Projector`, `Box`, `toColumnMajor`, `DEFAULT_BOX`, `DEFAULT_PROJECTOR`, `createRenderer`, `useOutputFeed`.
- Produces: `createProjectiveMaterial(texture): THREE.ShaderMaterial`; `setProjector(material, cam: ProjectorCamera): void`; `class SimScene { constructor(host, texture); setLayout(box, projector): void; start(): void; dispose(): void }`.

No unit tests (three.js and DOM). Verification is `tsc` and `npm run build` (both pages build; the main bundle must not contain three) plus Lyndz's visual check.

- [ ] **Step 1: Dependencies and Vite entries**

Run: `npm install three && npm install -D @types/three` (use the versions npm resolves; report them). Then `vite.config.ts`:
```ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS matters: WebGPU only exists in secure contexts, and a LAN IP over plain
// http is NOT one. Without this the phone silently falls back to WebGL2.
export default defineConfig({
  plugins: [react(), basicSsl()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        simulator: fileURLToPath(new URL('./simulator.html', import.meta.url)),
      },
    },
  },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
```

`simulator.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>HyperMapping Simulator</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/sim/main.tsx"></script>
  </body>
</html>
```

`src/sim/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client';
import '../index.css';
import { SimApp } from './SimApp';

createRoot(document.getElementById('root')!).render(<SimApp />);
```

- [ ] **Step 2: `src/sim/projective-material.ts`**
```ts
import * as THREE from 'three';
import { toColumnMajor } from './math';
import type { ProjectorCamera } from './solve';

const VERT = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// Projective texturing: the same view-projection matrix the solver uses decides where each
// surface point lands in the projector image. NDC +Y is the top of the image; the CanvasTexture
// has flipY = true, so v = ndc.y * 0.5 + 0.5 samples the right row.
const FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform mat4 uProjViewProj;
uniform vec3 uEye;
varying vec3 vWorld;
varying vec3 vNormalW;
void main() {
  vec4 clip = uProjViewProj * vec4(vWorld, 1.0);
  bool facing = dot(vNormalW, uEye - vWorld) > 0.0;
  if (clip.w <= 0.0 || !facing) { gl_FragColor = vec4(0.08, 0.08, 0.10, 1.0); return; }
  vec2 ndc = clip.xy / clip.w;
  if (abs(ndc.x) > 1.0 || abs(ndc.y) > 1.0) { gl_FragColor = vec4(0.08, 0.08, 0.10, 1.0); return; }
  gl_FragColor = texture2D(uTex, ndc * 0.5 + 0.5);
}`;

export function createProjectiveMaterial(texture: THREE.Texture): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTex: { value: texture },
      uProjViewProj: { value: new THREE.Matrix4() },
      uEye: { value: new THREE.Vector3() },
    },
  });
}

export function setProjector(material: THREE.ShaderMaterial, cam: ProjectorCamera): void {
  (material.uniforms.uProjViewProj.value as THREE.Matrix4).fromArray(toColumnMajor(cam.viewProj));
  (material.uniforms.uEye.value as THREE.Vector3).set(cam.eye[0], cam.eye[1], cam.eye[2]);
}
```

- [ ] **Step 3: `src/sim/scene.ts`**
```ts
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Box } from './box';
import { toColumnMajor } from './math';
import { createProjectiveMaterial, setProjector } from './projective-material';
import { PROJECTOR_FAR, PROJECTOR_NEAR, projectorCamera, type Projector, type ProjectorCamera } from './solve';

const DEG = Math.PI / 180;

/** The three.js side of the simulator: floor, box, projector marker + frustum, orbit view. */
export class SimScene {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
  private readonly controls: OrbitControls;
  private readonly material: THREE.ShaderMaterial;
  private readonly boxMesh: THREE.Mesh;
  private readonly boxEdges: THREE.LineSegments;
  private readonly marker: THREE.Mesh;
  private readonly frustum: THREE.LineSegments;
  private readonly observer: ResizeObserver;
  private raf = 0;
  private running = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly texture: THREE.Texture,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    host.appendChild(this.renderer.domElement);
    this.scene.background = new THREE.Color(0x111114);

    this.camera.position.set(4, 3, 5);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 0.5, 0);
    this.controls.update();

    this.scene.add(new THREE.GridHelper(10, 20, 0x444450, 0x2a2a32));

    this.material = createProjectiveMaterial(texture);
    this.boxMesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), this.material);
    this.boxEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(this.boxMesh.geometry),
      new THREE.LineBasicMaterial({ color: 0x555566 }),
    );
    this.marker = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.1, 0.25), new THREE.MeshBasicMaterial({ color: 0xffcc00 }));
    this.frustum = new THREE.LineSegments(
      new THREE.BufferGeometry(),
      new THREE.LineBasicMaterial({ color: 0xffcc00, transparent: true, opacity: 0.5 }),
    );
    this.scene.add(this.boxMesh, this.boxEdges, this.marker, this.frustum);

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }

  private resize(): void {
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Rebuild the box, move the projector marker and frustum, and update the projective matrices. */
  setLayout(box: Box, projector: Projector): void {
    this.boxMesh.geometry.dispose();
    this.boxMesh.geometry = new THREE.BoxGeometry(box.width, box.height, box.depth);
    this.boxEdges.geometry.dispose();
    this.boxEdges.geometry = new THREE.EdgesGeometry(this.boxMesh.geometry);
    for (const o of [this.boxMesh, this.boxEdges]) {
      o.position.set(0, box.height / 2, 0);
      o.rotation.y = box.yawDeg * DEG;
    }
    const cam = projectorCamera(projector, box);
    setProjector(this.material, cam);
    this.marker.position.set(cam.eye[0], cam.eye[1], cam.eye[2]);
    this.marker.lookAt(0, box.height / 2, 0);
    this.updateFrustum(cam, projector);
  }

  private updateFrustum(cam: ProjectorCamera, projector: Projector): void {
    const inv = new THREE.Matrix4().fromArray(toColumnMajor(cam.viewProj)).invert();
    const depth = Math.max(1, projector.distance * 1.2);
    const n = PROJECTOR_NEAR;
    const f = PROJECTOR_FAR;
    const zNdc = (f + n) / (f - n) - (2 * f * n) / ((f - n) * depth);
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([x, y]) => new THREE.Vector3(x, y, zNdc).applyMatrix4(inv));
    const eye = new THREE.Vector3(cam.eye[0], cam.eye[1], cam.eye[2]);
    const pts: THREE.Vector3[] = [];
    corners.forEach((c, i) => {
      pts.push(eye, c, c, corners[(i + 1) % 4]);
    });
    this.frustum.geometry.dispose();
    this.frustum.geometry = new THREE.BufferGeometry().setFromPoints(pts);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(tick);
      this.texture.needsUpdate = true; // the projector image is a live canvas
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(tick);
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.controls.dispose();
    this.boxMesh.geometry.dispose();
    this.boxEdges.geometry.dispose();
    (this.boxEdges.material as THREE.Material).dispose();
    this.marker.geometry.dispose();
    (this.marker.material as THREE.Material).dispose();
    this.frustum.geometry.dispose();
    (this.frustum.material as THREE.Material).dispose();
    this.material.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
```

- [ ] **Step 4: `src/sim/SimControls.tsx`**
```tsx
import type { Box } from './box';
import type { Projector } from './solve';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}

function Slider({ label, value, min, max, step, unit = '', onChange }: SliderProps) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0 text-zinc-300">{label}</span>
      <input
        type="range"
        className="flex-1"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
      <span className="w-16 text-right tabular-nums text-zinc-400">
        {value.toFixed(2)}
        {unit}
      </span>
    </label>
  );
}

interface Props {
  box: Box;
  projector: Projector;
  onBox: (b: Box) => void;
  onProjector: (p: Projector) => void;
}

export function SimControls({ box, projector, onBox, onProjector }: Props) {
  const setB = (patch: Partial<Box>) => onBox({ ...box, ...patch });
  const setP = (patch: Partial<Projector>) => onProjector({ ...projector, ...patch });
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-white">Box (metres)</h2>
      <Slider label="Width" value={box.width} min={0.2} max={3} step={0.05} onChange={(v) => setB({ width: v })} />
      <Slider label="Height" value={box.height} min={0.2} max={3} step={0.05} onChange={(v) => setB({ height: v })} />
      <Slider label="Depth" value={box.depth} min={0.2} max={3} step={0.05} onChange={(v) => setB({ depth: v })} />
      <Slider label="Turn" value={box.yawDeg} min={-180} max={180} step={1} unit="°" onChange={(v) => setB({ yawDeg: v })} />
      <h2 className="mt-2 text-sm font-semibold text-white">Projector</h2>
      <Slider label="Distance" value={projector.distance} min={0.5} max={10} step={0.05} onChange={(v) => setP({ distance: v })} />
      <Slider label="Side angle" value={projector.azimuthDeg} min={-180} max={180} step={1} unit="°" onChange={(v) => setP({ azimuthDeg: v })} />
      <Slider label="Lens height" value={projector.height} min={0} max={4} step={0.05} onChange={(v) => setP({ height: v })} />
      <Slider label="Throw ratio" value={projector.throwRatio} min={0.4} max={3} step={0.05} onChange={(v) => setP({ throwRatio: v })} />
      <Slider label="Lens shift" value={projector.shiftY} min={-0.5} max={0.5} step={0.01} onChange={(v) => setP({ shiftY: v })} />
    </div>
  );
}
```

- [ ] **Step 5: `src/sim/SimApp.tsx` (view + live feed + controls; Solve/Send arrive in Task 6)**
```tsx
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { createRenderer, type Renderer } from '../renderer';
import { useOutputFeed } from '../ui/useOutputFeed';
import type { Box } from './box';
import { DEFAULT_BOX, DEFAULT_PROJECTOR } from './defaults';
import { SimScene } from './scene';
import { SimControls } from './SimControls';
import type { Projector } from './solve';

const OUTPUT_HEIGHT = 720;

export function SimApp() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box>(DEFAULT_BOX);
  const [projector, setProjector] = useState<Projector>(DEFAULT_PROJECTOR);
  const [renderer, setRenderer] = useState<Renderer | null>(null);
  const [outCanvas, setOutCanvas] = useState<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sceneRef = useRef<SimScene | null>(null);

  // The projector image: the app's own renderer drawing into a hidden canvas, exactly like an
  // Output window. Forced to WebGL2 with a preserved buffer so three.js can sample it any time.
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(OUTPUT_HEIGHT * projector.aspect);
    canvas.height = OUTPUT_HEIGHT;
    let disposed = false;
    let created: Renderer | null = null;
    createRenderer(canvas, 'webgl2', { preserveDrawingBuffer: true })
      .then((r) => {
        if (disposed) {
          r.destroy();
          return;
        }
        created = r;
        r.start();
        setOutCanvas(canvas);
        setRenderer(r);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      disposed = true;
      created?.destroy();
      setRenderer(null);
      setOutCanvas(null);
    };
  }, [projector.aspect]);

  useOutputFeed(renderer);

  // The 3D scene, created once the projector image exists.
  useEffect(() => {
    if (!outCanvas || !hostRef.current) return;
    const texture = new THREE.CanvasTexture(outCanvas);
    texture.generateMipmaps = false; // re-uploaded every frame: skip mipmap generation
    texture.minFilter = THREE.LinearFilter;
    const scene = new SimScene(hostRef.current, texture);
    sceneRef.current = scene;
    scene.start();
    return () => {
      scene.dispose();
      texture.dispose();
      sceneRef.current = null;
    };
  }, [outCanvas]);

  useEffect(() => {
    sceneRef.current?.setLayout(box, projector);
  }, [box, projector, outCanvas]);

  return (
    <div className="fixed inset-0 flex flex-col bg-zinc-950 text-white md:flex-row">
      <div ref={hostRef} className="relative min-h-0 flex-1" />
      <aside className="max-h-[45%] w-full shrink-0 overflow-auto border-t border-zinc-800 p-4 md:max-h-none md:w-80 md:border-l md:border-t-0">
        <h1 className="mb-1 text-base font-semibold">Virtual projector</h1>
        <p className="mb-3 text-xs text-zinc-400">
          Open the main app in another tab and load a video: it appears on the box here.
        </p>
        {error && <p className="mb-2 text-xs text-amber-400">{error}</p>}
        <SimControls box={box} projector={projector} onBox={setBox} onProjector={setProjector} />
      </aside>
    </div>
  );
}
```

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all pass; the build output lists both `index.html` and `simulator.html`; the simulator's chunk contains three.js and the main entry chunk does not (compare chunk sizes with the previous build: the main app's JS must not have grown by three's size, about 600 KB). State in the report that this task has no unit tests and report the installed `three` / `@types/three` versions. If `three/addons/...` types do not resolve, use the path the installed `@types/three` exposes and report it.
```bash
git add package.json package-lock.json vite.config.ts simulator.html src/sim
git commit -m "feat(sim): simulator page projecting the real output onto a 3D box

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

> **CHECKPOINT — end of Stage 3 (needs Lyndz's eyes).** Stop and ask Lyndz to: run `npm run dev` (watch memory), open the app and load a video with something asymmetric (text, or an arrow), open `https://localhost:5173/simulator.html`, and check: the video appears on the visible box faces; text is not mirrored or upside down; dragging a slider moves the projector marker and the yellow frustum; orbiting works. Report what they see before Stage 4.

---

## STAGE 4 — Solve, Send, docs

### Task 6: Solve / Send to app / status / README

**Files:**
- Create: `src/sim/describe.ts`
- Test: `src/sim/describe.test.ts`
- Modify (full replacement): `src/sim/SimApp.tsx`
- Modify: `README.md`

**Interfaces:**
- Consumes: `solveFaces`, `toSurfaces`, `SolveResult`, `SkipReason`, `CHANNEL`, `useOutputFeed`.
- Produces: `describeSolve(r: SolveResult): string[]`.

- [ ] **Step 1: Write the failing test**

`src/sim/describe.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { Box } from './box';
import { DEFAULT_BOX, DEFAULT_PROJECTOR } from './defaults';
import { describeSolve } from './describe';
import { solveFaces, type Projector } from './solve';

const CUBE: Box = { width: 1, height: 1, depth: 1, yawDeg: 0 };
const FRONT_ON: Projector = { distance: 3, azimuthDeg: 0, height: 0.5, throwRatio: 1.2, aspect: 16 / 9, shiftY: 0 };

describe('describeSolve', () => {
  it('lists the faces used, left to right, and nothing else for a clean solve', () => {
    const lines = describeSolve(solveFaces(DEFAULT_BOX, DEFAULT_PROJECTOR));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Faces used \(left to right\): /);
    for (const f of ['front', 'right', 'top']) expect(lines[0]).toContain(f);
  });
  it('says so when nothing is visible', () => {
    const lines = describeSolve(solveFaces(CUBE, { ...FRONT_ON, distance: 0 }));
    expect(lines).toEqual(['No faces are visible from this projector position.']);
  });
  it('explains a face that is too far outside the image', () => {
    const lines = describeSolve(solveFaces(CUBE, { ...FRONT_ON, throwRatio: 4 }));
    expect(lines).toContain('Skipped front: too far outside the image (widen the throw ratio or move back).');
  });
  it('flags faces partly outside the image', () => {
    const lines = describeSolve(solveFaces(CUBE, { ...FRONT_ON, throwRatio: 1.875 }));
    expect(lines).toContain('Partly outside the projector image: front');
  });
  it('explains a face that is edge-on or too small', () => {
    const lines = describeSolve(solveFaces(CUBE, { ...FRONT_ON, distance: 200 }));
    expect(lines).toContain('Skipped front: edge-on or too small to map from here.');
  });
  it('explains a face behind the projector', () => {
    const lines = describeSolve(
      solveFaces({ width: 1, height: 0.4, depth: 10, yawDeg: 0 }, { ...FRONT_ON, height: 1, distance: 3 }),
    );
    expect(lines).toContain('Skipped top: behind the projector.');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/sim/describe.test.ts`
Expected: FAIL — `./describe` not found.

- [ ] **Step 3: Implement `src/sim/describe.ts`**
```ts
import type { SolveResult } from './solve';

/** Plain-English summary of a solve, one line per thing worth telling the user. */
export function describeSolve(r: SolveResult): string[] {
  const lines: string[] = [];
  if (r.faces.length === 0) {
    lines.push('No faces are visible from this projector position.');
  } else {
    const names = [...r.faces].sort((a, b) => a.centroidX - b.centroidX).map((f) => f.face);
    lines.push(`Faces used (left to right): ${names.join(', ')}`);
  }
  const partly = r.faces.filter((f) => f.partlyOutside).map((f) => f.face);
  if (partly.length) lines.push(`Partly outside the projector image: ${partly.join(', ')}`);
  for (const s of r.skipped) {
    if (s.reason === 'behind-projector') lines.push(`Skipped ${s.face}: behind the projector.`);
    else if (s.reason === 'off-image') {
      lines.push(`Skipped ${s.face}: too far outside the image (widen the throw ratio or move back).`);
    } else if (s.reason === 'degenerate') {
      lines.push(`Skipped ${s.face}: edge-on or too small to map from here.`);
    }
    // 'facing-away' is the normal case for the back of a box: not worth a line.
  }
  return lines;
}
```

- [ ] **Step 4: Replace `src/sim/SimApp.tsx` with the full page**
```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { CHANNEL } from '../output/protocol';
import { createRenderer, type Renderer } from '../renderer';
import type { Surface } from '../surfaces/types';
import { useOutputFeed } from '../ui/useOutputFeed';
import type { Box } from './box';
import { DEFAULT_BOX, DEFAULT_PROJECTOR } from './defaults';
import { describeSolve } from './describe';
import { SimScene } from './scene';
import { SimControls } from './SimControls';
import { solveFaces, toSurfaces, type Projector } from './solve';

const OUTPUT_HEIGHT = 720;

type Mode = 'app' | 'solved';

export function SimApp() {
  const hostRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box>(DEFAULT_BOX);
  const [projector, setProjector] = useState<Projector>(DEFAULT_PROJECTOR);
  const [renderer, setRenderer] = useState<Renderer | null>(null);
  const [outCanvas, setOutCanvas] = useState<HTMLCanvasElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>('app');
  const [note, setNote] = useState<string | null>(null);
  const sceneRef = useRef<SimScene | null>(null);

  const solve = useMemo(() => solveFaces(box, projector), [box, projector]);
  const solvedSurfaces = useMemo(() => toSurfaces(solve), [solve]);
  const summary = useMemo(() => describeSolve(solve), [solve]);

  // The projector image: the app's own renderer drawing into a hidden canvas, exactly like an
  // Output window. Forced to WebGL2 with a preserved buffer so three.js can sample it any time.
  useEffect(() => {
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(OUTPUT_HEIGHT * projector.aspect);
    canvas.height = OUTPUT_HEIGHT;
    let disposed = false;
    let created: Renderer | null = null;
    createRenderer(canvas, 'webgl2', { preserveDrawingBuffer: true })
      .then((r) => {
        if (disposed) {
          r.destroy();
          return;
        }
        created = r;
        r.start();
        setOutCanvas(canvas);
        setRenderer(r);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      disposed = true;
      created?.destroy();
      setRenderer(null);
      setOutCanvas(null);
    };
  }, [projector.aspect]);

  // Faces from the main app are remembered always, but only drawn while we follow the app.
  const appSurfaces = useRef<Surface[]>([]);
  const modeRef = useRef<Mode>(mode);
  modeRef.current = mode;
  const rendererRef = useRef<Renderer | null>(renderer);
  rendererRef.current = renderer;
  const onAppSurfaces = useCallback((s: Surface[]) => {
    appSurfaces.current = s;
    if (modeRef.current === 'app') rendererRef.current?.setSurfaces(s);
  }, []);
  useOutputFeed(renderer, onAppSurfaces);

  // Which layout the projector image shows: the app's, or the one we just computed.
  useEffect(() => {
    if (!renderer) return;
    if (mode === 'solved') {
      if (solvedSurfaces.length) renderer.setSurfaces(solvedSurfaces);
    } else {
      renderer.setSurfaces(appSurfaces.current);
    }
  }, [renderer, mode, solvedSurfaces]);

  // The 3D scene, created once the projector image exists.
  useEffect(() => {
    if (!outCanvas || !hostRef.current) return;
    const texture = new THREE.CanvasTexture(outCanvas);
    texture.generateMipmaps = false; // re-uploaded every frame: skip mipmap generation
    texture.minFilter = THREE.LinearFilter;
    const scene = new SimScene(hostRef.current, texture);
    sceneRef.current = scene;
    scene.start();
    return () => {
      scene.dispose();
      texture.dispose();
      sceneRef.current = null;
    };
  }, [outCanvas]);

  useEffect(() => {
    sceneRef.current?.setLayout(box, projector);
  }, [box, projector, outCanvas]);

  const sendToApp = () => {
    if (!solvedSurfaces.length) return;
    const ch = new BroadcastChannel(CHANNEL);
    ch.postMessage({ type: 'layout', surfaces: solvedSurfaces });
    ch.close();
    setMode('app'); // the app echoes its new faces back, so we follow it again
    setNote('Sent. The main app tab now uses this layout (nudge the pins to fine-tune).');
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-zinc-950 text-white md:flex-row">
      <div ref={hostRef} className="relative min-h-0 flex-1" />
      <aside className="max-h-[50%] w-full shrink-0 overflow-auto border-t border-zinc-800 p-4 md:max-h-none md:w-80 md:border-l md:border-t-0">
        <h1 className="mb-1 text-base font-semibold">Virtual projector</h1>
        <p className="mb-3 text-xs text-zinc-400">
          Open the main app in another tab and load a video: it appears on the box here.
        </p>
        {error && <p className="mb-2 text-xs text-amber-400">{error}</p>}

        <div className="mb-3 flex flex-wrap gap-2">
          <button className="rounded-lg bg-cyan-500 px-3 py-2 text-sm font-medium text-black" onClick={() => { setMode('solved'); setNote(null); }}>
            Solve
          </button>
          <button
            className="rounded-lg bg-zinc-700 px-3 py-2 text-sm disabled:opacity-40"
            disabled={mode !== 'solved' || solvedSurfaces.length === 0}
            onClick={sendToApp}
          >
            Send to app
          </button>
          <button className="rounded-lg bg-zinc-700 px-3 py-2 text-sm disabled:opacity-40" disabled={mode === 'app'} onClick={() => setMode('app')}>
            Show app layout
          </button>
        </div>
        <p className="mb-1 text-xs text-zinc-400">
          Showing: <span className="text-white">{mode === 'solved' ? 'computed layout' : "the main app's layout"}</span>
        </p>
        <p className="mb-2 text-xs text-zinc-500">Send to app replaces the main app's faces with the computed ones.</p>
        <ul className="mb-3 list-disc pl-4 text-xs text-zinc-300">
          {summary.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {note && <p className="mb-3 text-xs text-emerald-400">{note}</p>}

        <SimControls box={box} projector={projector} onBox={setBox} onProjector={setProjector} />
      </aside>
    </div>
  );
}
```

- [ ] **Step 5: README**

Add a section before "Known limits":
```markdown
## Virtual projector (simulator)

- Open `/simulator.html` (for example `https://localhost:5173/simulator.html`) in another tab while the main app is open and a video is loaded. It shows a 3D box with your real output projected onto it from a virtual projector; drag to orbit.
- Set the box size and turn, and the projector's distance, side angle, lens height, throw ratio (from its spec sheet) and lens shift.
- **Solve** computes each visible face's four pins from those numbers and previews the video wrapped on the box. **Send to app** replaces the main app's faces with them, so you start from a good layout and only nudge the pins.
- It is a starting point built from measurements: tape-measure error, the projector's real lens shift and your screen's shape (the simulator assumes a 16:9 projector image) will still need small pin adjustments.
```

- [ ] **Step 6: Verify and commit**

Run: `npx vitest run src/sim && npx tsc --noEmit && npm test && npm run build`
Expected: all pass; the test count is higher than before Task 1. State in the report that `SimApp` has no unit tests (DOM/three).
```bash
git add src/sim README.md
git commit -m "feat(sim): Solve, Send to app, solve summary and README

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

> **CHECKPOINT — end of Stage 4 (needs Lyndz's eyes).** Final whole-branch review, then ask Lyndz to run the end-to-end check: app + simulator side by side, load a video in the app, Solve (video wraps the box), Send to app (pins appear on every visible face), compare with a real box if available.

---

## Self-Review

**Spec coverage:** maths module with box, projector camera, lens shift, solver, ordering, skip reasons, `toSurfaces` (Tasks 1-2); `layout` message and Editor adoption (Task 3); renderer `preserveDrawingBuffer` option and shared `useOutputFeed` with Output refactor (Task 4); simulator page, separate Vite entry, three dependency confined to `src/sim/`, projective shader fed by the solver's matrices, hidden WebGL2 output renderer, orbit controls (Task 5); Solve / Send to app / layout-source mode / controls / status / README (Task 6). Spec edge cases 1-10: 1,2,3,4,5,6,7,8,9 are unit-tested in Tasks 1-2 and 6; case 10 (malformed `layout` ignored by the Editor) is tested at the parser in Task 3 and the Editor ignores `null` messages by construction.

**Placeholder scan:** none; every code step carries full code. The only numbers a reviewer must recompute are the analytic front-on constants in Task 2's test, with the derivation stated in the test comment.

**Type consistency:** `V3`, `Mat4`, `Box`, `FaceId`, `Face`, `Projector`, `ProjectorCamera`, `SolveResult`, `SolvedFace`, `SkipReason`, `PROJECTOR_NEAR/FAR`, `projectorCamera`, `projectToUnit`, `orderClockwise`, `solveFaces`, `toSurfaces`, `describeSolve`, `DEFAULT_BOX/PROJECTOR`, `RendererOptions`, `useOutputFeed(renderer, onSurfaces?)`, `SimScene(host, texture).setLayout(box, projector)/start()/dispose()`, `Msg` variant `layout` are spelled identically wherever used.

**Known risks to watch at execution time:** (1) the three.js types for `three/addons/...`; (2) the shader's orientation and mirroring, which only the Stage 3 visual check can confirm; (3) `Float32Array` / `Matrix4.fromArray` typing; (4) the two WebGL contexts on one page.
