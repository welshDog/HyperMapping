# HyperMapping M1 (Core) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A web app you can open on a phone that plays a local video onto a perspective-correct, four-corner-pinned surface, with an output-only mode and a second `#output` window for the projector.

**Architecture:** Pure math (`warp/`) feeds a swappable `Renderer` interface with WebGPU and WebGL2 implementations that share a frame loop. React + Tailwind hosts the canvas and an SVG pin overlay; drag state lives in refs so pointer moves never re-render React. The editor and the output window talk over `BroadcastChannel`.

**Tech Stack:** Vite 5, React 18, TypeScript 5 (strict), Tailwind 3, Vitest 2, WebGPU / WebGL2.

**Spec:** `docs/superpowers/specs/2026-10-14-hypermapping-design.md`

**Scope:** Milestone 1 of 6 only. Scenes, mesh/bezier warp, generative/audio visuals, auto-calibration and the native shell each get their own plan after M1 runs on a real phone.

## Global Constraints

- Web-first PWA: React + Tailwind + Vite + TypeScript, no backend, no Pi/Docker, no tiers.
- WebGPU is the primary renderer; WebGL2 is the fallback. Both implement the single `Renderer` interface in `src/renderer/types.ts`.
- Four-corner pin MUST use a 3x3 **homography** to place mesh vertices (never bilinear blending).
- Mesh is a 20x20 grid (21x21 = 441 vertices); positions in NDC, Y flipped from screen space.
- Corners are stored in **unit space** (0..1 of the surface, Y down), so editor and output windows agree whatever their pixel size.
- High-frequency drag state lives in refs / direct DOM mutation, not React state. Use pointer events with pointer capture and `touch-action: none`.
- Output-only mode must show nothing but the warped video (no editor UI).
- Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Working directory for every command: `h:\HYPERFOCUSZONE\HperCore\HyperMapping`.

## Review Focus

1. **Corner dragged across the opposite edge (bow-tie), onto a line, or into a sliver** — must never produce NaN/Infinity geometry; the last valid quad stays. Tested in Tasks 2 and 3.
2. **Finger dragged far off the canvas** — pin is clamped to `[-0.5, 1.5]` in unit space, never runs away. Tested in Task 2.
3. **Video not loaded, still buffering, or zero-sized (or swapped mid-play)** — draw a black frame, never throw. Tested in Task 6 (`isVideoReady`).
4. **Rotation, 3x device-pixel-ratio, zero-size container** — backing store is clamped to 1..4096 px and DPR to 2. Tested in Task 6 (`computeBackingSize`).
5. **Output window opened after the editor already has state/video, or junk on the channel** — `hello` handshake replays state; `parseMsg` rejects malformed messages. Tested in Task 5.

---

## File Structure

```
HyperMapping/
  package.json  tsconfig.json  vite.config.ts  tailwind.config.js  postcss.config.js
  index.html  README.md  .gitignore
  public/manifest.webmanifest
  docs/notes/                      (moved Gemini export)
  src/
    main.tsx  App.tsx  index.css
    warp/types.ts  warp/homography.ts  warp/quad.ts  warp/mesh.ts   (+ *.test.ts)
    renderer/types.ts  renderer/quality.ts  renderer/frame-loop.ts
    renderer/fit.ts  renderer/video-ready.ts  renderer/backends.ts
    renderer/webgl2.ts  renderer/webgpu.ts  renderer/index.ts        (+ *.test.ts)
    output/protocol.ts                                               (+ test)
    sources/video.ts
    ui/useRenderer.ts  ui/PinOverlay.tsx  ui/Editor.tsx  ui/Output.tsx
```

Responsibilities: `warp/*` is pure math with no DOM. `renderer/*` knows nothing about React. `ui/*` knows nothing about shader code.

---

### Task 1: Scaffold the project

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `tailwind.config.js`, `postcss.config.js`, `index.html`, `.gitignore`, `public/manifest.webmanifest`, `src/index.css`, `src/main.tsx`, `src/App.tsx`, `src/smoke.test.ts`
- Move: the Gemini export files into `docs/notes/`

**Interfaces:**
- Produces: working `npm test` (Vitest, node environment), `npm run build`, `npm run dev` (HTTPS on the LAN).

- [ ] **Step 1: Init git and move the notes**

```bash
git init
mkdir -p docs/notes
mv "Building Projection Mapping Software.pdf" interactive_visual_im_*.html \
   "Technical Architecture" "The golden rule" "projection mapping app for smartphones" \
   "Building a mobile projection mapping app" "The Vertex Shader" "The Mathematical Formula" \
   "Building a projection mapping app for modern smartphones" \
   "React and SVG overlay to handle the touch mechanics" \
   "structure the updateWebGLMesh function" "best questions I should be asking" docs/notes/
ls
```
Expected: the root now shows `docs`, no loose note files.

- [ ] **Step 2: Write config files**

`package.json`:
```json
{
  "name": "hypermapping",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite --host",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview --host",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1"
  },
  "devDependencies": {
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-basic-ssl": "^1.1.0",
    "@vitejs/plugin-react": "^4.3.1",
    "@webgpu/types": "^0.1.43",
    "autoprefixer": "^10.4.19",
    "postcss": "^8.4.40",
    "tailwindcss": "^3.4.7",
    "typescript": "^5.5.4",
    "vite": "^5.4.0",
    "vitest": "^2.0.5"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["@webgpu/types", "vite/client"]
  },
  "include": ["src"]
}
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// HTTPS matters: WebGPU only exists in secure contexts, and a LAN IP over plain
// http is NOT one. Without this the phone silently falls back to WebGL2.
export default defineConfig({
  plugins: [react(), basicSsl()],
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
```

`tailwind.config.js`:
```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

`postcss.config.js`:
```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

`.gitignore`:
```
node_modules
dist
*.log
```

`public/manifest.webmanifest`:
```json
{
  "name": "HyperMapping",
  "short_name": "HyperMapping",
  "start_url": ".",
  "display": "fullscreen",
  "orientation": "any",
  "background_color": "#000000",
  "theme_color": "#000000"
}
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="theme-color" content="#000000" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <title>HyperMapping</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`src/index.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root { height: 100%; margin: 0; background: #000; overscroll-behavior: none; }
```

`src/main.tsx` (no StrictMode on purpose: its double-mount would create and destroy a GPU context twice on the same canvas):
```tsx
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<App />);
```

`src/App.tsx` (placeholder, replaced in Task 8):
```tsx
export function App() {
  return <div className="p-4 text-white">HyperMapping</div>;
}
```

`src/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';

describe('toolchain', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 3: Install and verify**

Run: `npm install && npm test && npm run build`
Expected: 1 test passes; build succeeds and writes `dist/`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite/React/Tailwind/Vitest project, move research notes to docs/notes"
```

---

### Task 2: Quad validation and homography math

**Files:**
- Create: `src/warp/types.ts`, `src/warp/homography.ts`, `src/warp/quad.ts`
- Test: `src/warp/homography.test.ts`, `src/warp/quad.test.ts`

**Interfaces:**
- Produces:
  - `type Vec2 = [number, number]`; `interface Corners { tl: Vec2; tr: Vec2; br: Vec2; bl: Vec2 }`; `const UNIT_CORNERS: Corners`; `cornersToArray(c: Corners): Vec2[]` (order tl, tr, br, bl)
  - `type Mat3 = number[]` (row-major, 9 numbers); `computeHomography(src: Vec2[], dst: Vec2[]): Mat3 | null`; `applyHomography(h: Mat3, p: Vec2): Vec2`
  - `isValidQuad(c: Corners, minArea?: number): boolean`; `clampCorner(p: Vec2, min?: number, max?: number): Vec2`

- [ ] **Step 1: Write the failing tests**

`src/warp/homography.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeHomography, applyHomography } from './homography';
import type { Vec2 } from './types';

const SQ: Vec2[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
const TRAP: Vec2[] = [[-0.5, 1], [0.5, 1], [1, -1], [-1, -1]];

describe('computeHomography', () => {
  it('maps each source corner exactly onto its destination corner', () => {
    const h = computeHomography(SQ, TRAP)!;
    expect(h).not.toBeNull();
    SQ.forEach((p, i) => {
      const q = applyHomography(h, p);
      expect(q[0]).toBeCloseTo(TRAP[i][0], 9);
      expect(q[1]).toBeCloseTo(TRAP[i][1], 9);
    });
  });

  it('is the identity when source and destination are the same quad', () => {
    const h = computeHomography(SQ, SQ)!;
    const q = applyHomography(h, [0.3, 0.7]);
    expect(q[0]).toBeCloseTo(0.3, 9);
    expect(q[1]).toBeCloseTo(0.7, 9);
  });

  it('keeps the diagonal straight (bilinear blending would bend it)', () => {
    const h = computeHomography(SQ, TRAP)!;
    const a = applyHomography(h, [0, 0]);
    const b = applyHomography(h, [0.5, 0.5]);
    const c = applyHomography(h, [1, 1]);
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    expect(Math.abs(cross)).toBeLessThan(1e-9);
  });

  it('returns null when the destination corners are collinear', () => {
    expect(computeHomography(SQ, [[0, 0], [1, 1], [2, 2], [3, 3]])).toBeNull();
  });
});
```

`src/warp/quad.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isValidQuad, clampCorner } from './quad';
import type { Corners } from './types';

const SQUARE: Corners = { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] };

describe('isValidQuad', () => {
  it('accepts a convex quad', () => {
    expect(isValidQuad(SQUARE)).toBe(true);
    expect(isValidQuad({ tl: [0.2, 0.1], tr: [0.9, 0.2], br: [0.8, 0.9], bl: [0.1, 0.7] })).toBe(true);
  });
  it('rejects a bow-tie (two corners swapped)', () => {
    expect(isValidQuad({ tl: [0, 0], tr: [1, 0], br: [0, 1], bl: [1, 1] })).toBe(false);
  });
  it('rejects a concave quad', () => {
    expect(isValidQuad({ tl: [0, 0], tr: [1, 0], br: [0.2, 0.2], bl: [0, 1] })).toBe(false);
  });
  it('rejects three collinear corners', () => {
    expect(isValidQuad({ tl: [0, 0], tr: [0.5, 0], br: [1, 0], bl: [0, 1] })).toBe(false);
  });
  it('rejects a sliver with almost no area', () => {
    expect(isValidQuad({ tl: [0, 0], tr: [1, 0], br: [1, 0.00005], bl: [0, 0.00005] })).toBe(false);
  });
  it('rejects NaN coordinates', () => {
    expect(isValidQuad({ ...SQUARE, tl: [NaN, 0] })).toBe(false);
  });
});

describe('clampCorner', () => {
  it('clamps a runaway drag into [-0.5, 1.5]', () => {
    expect(clampCorner([-2, 3])).toEqual([-0.5, 1.5]);
  });
  it('leaves in-range points alone', () => {
    expect(clampCorner([0.3, 0.4])).toEqual([0.3, 0.4]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/warp`
Expected: FAIL — modules `./homography`, `./quad`, `./types` not found.

- [ ] **Step 3: Implement**

`src/warp/types.ts`:
```ts
export type Vec2 = [number, number];

/** Corner order everywhere in the app: tl, tr, br, bl (clockwise from top-left). */
export interface Corners {
  tl: Vec2;
  tr: Vec2;
  br: Vec2;
  bl: Vec2;
}

export const UNIT_CORNERS: Corners = { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] };

export const cornersToArray = (c: Corners): Vec2[] => [c.tl, c.tr, c.br, c.bl];
```

`src/warp/homography.ts`:
```ts
import type { Vec2 } from './types';

/** Row-major 3x3 matrix, 9 numbers, with h[8] === 1. */
export type Mat3 = number[];

/** Solve for the projective transform taking src[i] -> dst[i] (4 point pairs). */
export function computeHomography(src: Vec2[], dst: Vec2[]): Mat3 | null {
  // Unknowns h0..h7 (h8 = 1):
  //   u = (h0 x + h1 y + h2) / (h6 x + h7 y + 1)
  //   v = (h3 x + h4 y + h5) / (h6 x + h7 y + 1)
  const a: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i];
    const [u, v] = dst[i];
    a.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    a.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  const h = solve8(a);
  return h ? [...h, 1] : null;
}

/** Gauss-Jordan on an 8x9 augmented matrix with partial pivoting. */
function solve8(m: number[][]): number[] | null {
  const n = 8;
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-12) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let c = col; c <= n; c++) m[r][c] -= f * m[col][c];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

export function applyHomography(h: Mat3, [x, y]: Vec2): Vec2 {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}
```

`src/warp/quad.ts`:
```ts
import { cornersToArray, type Corners, type Vec2 } from './types';

/**
 * True when the four corners form a non-degenerate convex quad.
 * Dragging a pin across the opposite edge makes a bow-tie, which has no valid
 * perspective transform; callers keep the previous valid quad instead.
 */
export function isValidQuad(c: Corners, minArea = 1e-4): boolean {
  const p = cornersToArray(c);
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = p[i];
    const b = p[(i + 1) % 4];
    const d = p[(i + 2) % 4];
    const cross = (b[0] - a[0]) * (d[1] - b[1]) - (b[1] - a[1]) * (d[0] - b[0]);
    if (!Number.isFinite(cross) || Math.abs(cross) < 1e-9) return false;
    const s = Math.sign(cross);
    if (sign === 0) sign = s;
    else if (s !== sign) return false;
  }
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = p[i];
    const b = p[(i + 1) % 4];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(area) / 2 >= minArea;
}

/** Keep a dragged corner within a sane range around the surface. */
export function clampCorner(p: Vec2, min = -0.5, max = 1.5): Vec2 {
  return [Math.min(max, Math.max(min, p[0])), Math.min(max, Math.max(min, p[1]))];
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/warp`
Expected: PASS (all tests in both files).

- [ ] **Step 5: Commit**

```bash
git add src/warp
git commit -m "feat(warp): homography solver, quad validation, corner clamp"
```

---

### Task 3: Mesh topology and warped positions

**Files:**
- Create: `src/warp/mesh.ts`
- Test: `src/warp/mesh.test.ts`

**Interfaces:**
- Consumes: `computeHomography`, `applyHomography`, `isValidQuad`, `UNIT_CORNERS`, `cornersToArray`, `Corners`, `Vec2`.
- Produces:
  - `const GRID = 20`
  - `unitToNdc(p: Vec2): Vec2` — `[x*2-1, 1-y*2]`
  - `interface MeshTopology { uvs: Float32Array; indices: Uint16Array; vertexCount: number }`
  - `buildTopology(cols?: number, rows?: number): MeshTopology` (vertex index = `r*(cols+1)+c`; tl=0, tr=cols, bl=rows*(cols+1), br=last)
  - `warpedPositions(corners: Corners, cols?: number, rows?: number, out?: Float32Array): Float32Array | null` — returns `null` (and does not touch `out`) when the quad is invalid.

- [ ] **Step 1: Write the failing test**

`src/warp/mesh.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildTopology, warpedPositions, unitToNdc, GRID } from './mesh';
import type { Corners } from './types';

const SQUARE: Corners = { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] };
const V = (buf: Float32Array, i: number) => [buf[2 * i], buf[2 * i + 1]];

describe('buildTopology', () => {
  it('builds a 21x21 vertex grid with 2400 indices', () => {
    const t = buildTopology();
    expect(GRID).toBe(20);
    expect(t.vertexCount).toBe(441);
    expect(t.uvs.length).toBe(882);
    expect(t.indices.length).toBe(2400);
    expect(Math.max(...t.indices)).toBe(440);
  });
  it('maps corner vertices to the corners of UV space', () => {
    const t = buildTopology();
    expect(V(t.uvs, 0)).toEqual([0, 0]);
    expect(V(t.uvs, 20)).toEqual([1, 0]);
    expect(V(t.uvs, 420)).toEqual([0, 1]);
    expect(V(t.uvs, 440)).toEqual([1, 1]);
  });
});

describe('unitToNdc', () => {
  it('flips Y and recentres', () => {
    expect(unitToNdc([0, 0])).toEqual([-1, 1]);
    expect(unitToNdc([1, 1])).toEqual([1, -1]);
    expect(unitToNdc([0.5, 0.5])).toEqual([0, 0]);
  });
});

describe('warpedPositions', () => {
  it('an unwarped square fills clip space', () => {
    const p = warpedPositions(SQUARE)!;
    expect(V(p, 0)).toEqual([-1, 1]);
    expect(V(p, 20)).toEqual([1, 1]);
    expect(V(p, 420)).toEqual([-1, -1]);
    expect(V(p, 440)).toEqual([1, -1]);
    expect(V(p, 220)[0]).toBeCloseTo(0, 9);
    expect(V(p, 220)[1]).toBeCloseTo(0, 9);
  });

  it('puts the corner vertices exactly on the requested pins', () => {
    const c: Corners = { tl: [0.3, 0.1], tr: [0.9, 0.2], br: [0.8, 0.9], bl: [0.1, 0.7] };
    const p = warpedPositions(c)!;
    const expected = [c.tl, c.tr, c.bl, c.br].map(unitToNdc);
    [0, 20, 420, 440].forEach((vi, k) => {
      expect(V(p, vi)[0]).toBeCloseTo(expected[k][0], 6);
      expect(V(p, vi)[1]).toBeCloseTo(expected[k][1], 6);
    });
  });

  it('returns null and leaves the buffer untouched for a bow-tie', () => {
    const out = new Float32Array(882).fill(7);
    const bow: Corners = { tl: [0, 0], tr: [1, 0], br: [0, 1], bl: [1, 1] };
    expect(warpedPositions(bow, GRID, GRID, out)).toBeNull();
    expect(out.every((v) => v === 7)).toBe(true);
  });

  it('writes into the provided buffer and returns it', () => {
    const out = new Float32Array(882);
    expect(warpedPositions(SQUARE, GRID, GRID, out)).toBe(out);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/warp/mesh.test.ts`
Expected: FAIL — `./mesh` not found.

- [ ] **Step 3: Implement**

`src/warp/mesh.ts`:
```ts
import { applyHomography, computeHomography } from './homography';
import { isValidQuad } from './quad';
import { UNIT_CORNERS, cornersToArray, type Corners, type Vec2 } from './types';

export const GRID = 20;

/** Unit space (0..1, Y down) -> WebGL/WebGPU normalized device coords (-1..1, Y up). */
export const unitToNdc = ([x, y]: Vec2): Vec2 => [x * 2 - 1, 1 - y * 2];

export interface MeshTopology {
  uvs: Float32Array;
  indices: Uint16Array;
  vertexCount: number;
}

/** Static data: uploaded to the GPU once and never changes. */
export function buildTopology(cols = GRID, rows = GRID): MeshTopology {
  const vertexCount = (cols + 1) * (rows + 1);
  const uvs = new Float32Array(vertexCount * 2);
  let k = 0;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      uvs[k++] = c / cols;
      uvs[k++] = r / rows;
    }
  }
  const indices = new Uint16Array(cols * rows * 6);
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i0 = r * (cols + 1) + c;
      const i1 = i0 + 1;
      const i2 = i0 + cols + 1;
      const i3 = i2 + 1;
      indices.set([i0, i2, i1, i1, i2, i3], n);
      n += 6;
    }
  }
  return { uvs, indices, vertexCount };
}

/**
 * Vertex positions in NDC for the video quad pinned to `corners` (unit space).
 * Each grid vertex goes through the homography, so straight lines stay straight.
 * Returns null (touching nothing) when the quad has no valid perspective transform.
 */
export function warpedPositions(
  corners: Corners,
  cols = GRID,
  rows = GRID,
  out?: Float32Array,
): Float32Array | null {
  if (!isValidQuad(corners)) return null;
  const dst = cornersToArray(corners).map(unitToNdc);
  const h = computeHomography(cornersToArray(UNIT_CORNERS), dst);
  if (!h) return null;
  const buf = out ?? new Float32Array((cols + 1) * (rows + 1) * 2);
  let k = 0;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const [x, y] = applyHomography(h, [c / cols, r / rows]);
      buf[k++] = x;
      buf[k++] = y;
    }
  }
  return buf;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/warp`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/warp/mesh.ts src/warp/mesh.test.ts
git commit -m "feat(warp): 20x20 mesh topology and homography-placed vertex positions"
```

---

### Task 4: Thermal guard and frame loop

**Files:**
- Create: `src/renderer/quality.ts`, `src/renderer/frame-loop.ts`
- Test: `src/renderer/quality.test.ts`, `src/renderer/frame-loop.test.ts`

**Interfaces:**
- Produces:
  - `interface Quality { scale: number; fpsCap: 30 | 60 }`
  - `class ThermalGuard { constructor(windowSize = 60); quality: Quality; push(frameMs: number): Quality }` — evaluates once per `windowSize` pushes; returns a new object only when quality changes.
  - `class FrameLoop { constructor(hooks: { draw(): void; onFrameTime?(ms: number): void }, raf?, caf?); fpsCap: 30 | 60; start(): void; stop(): void }`

- [ ] **Step 1: Write the failing tests**

`src/renderer/quality.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { ThermalGuard, type Quality } from './quality';

function feed(g: ThermalGuard, ms: number, n: number): Quality {
  let q = g.quality;
  for (let i = 0; i < n; i++) q = g.push(ms);
  return q;
}

describe('ThermalGuard', () => {
  it('starts at full quality', () => {
    expect(new ThermalGuard().quality).toEqual({ scale: 1, fpsCap: 60 });
  });

  it('does nothing until a full window has been collected', () => {
    expect(feed(new ThermalGuard(), 40, 59).scale).toBe(1);
  });

  it('steps resolution down 0.1 per slow window', () => {
    const g = new ThermalGuard();
    expect(feed(g, 30, 60).scale).toBe(0.9);
    expect(feed(g, 30, 60).scale).toBe(0.8);
  });

  it('floors at 0.5 resolution, then drops to 30fps', () => {
    const g = new ThermalGuard();
    const q = feed(g, 30, 60 * 5);
    expect(q).toEqual({ scale: 0.5, fpsCap: 60 });
    expect(feed(g, 30, 60)).toEqual({ scale: 0.5, fpsCap: 30 });
  });

  it('recovers resolution one step after five healthy windows', () => {
    const g = new ThermalGuard();
    feed(g, 30, 120); // scale 0.8
    expect(feed(g, 10, 60 * 5).scale).toBe(0.9);
    expect(feed(g, 10, 60 * 5).scale).toBe(1);
  });

  it('never raises the fps cap or resolution once capped (no oscillation)', () => {
    const g = new ThermalGuard();
    feed(g, 30, 60 * 6); // capped at 30fps, scale 0.5
    expect(feed(g, 33, 60 * 20)).toEqual({ scale: 0.5, fpsCap: 30 });
  });
});
```

`src/renderer/frame-loop.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { FrameLoop } from './frame-loop';

function fakeRaf() {
  let cb: ((t: number) => void) | null = null;
  let n = 0;
  return {
    raf: (f: (t: number) => void) => ((cb = f), ++n),
    caf: () => {
      cb = null;
    },
    tick: (t: number) => {
      const f = cb;
      cb = null;
      f?.(t);
    },
  };
}

describe('FrameLoop', () => {
  it('draws every frame at 60fps and reports frame times', () => {
    const f = fakeRaf();
    const times: number[] = [];
    let draws = 0;
    const loop = new FrameLoop({ draw: () => draws++, onFrameTime: (ms) => times.push(ms) }, f.raf, f.caf);
    loop.start();
    [0, 16.7, 33.4, 50.1].forEach(f.tick);
    expect(draws).toBe(4);
    expect(times.length).toBe(3);
    expect(times[0]).toBeCloseTo(16.7, 5);
  });

  it('draws every other frame at a 30fps cap', () => {
    const f = fakeRaf();
    let draws = 0;
    const loop = new FrameLoop({ draw: () => draws++ }, f.raf, f.caf);
    loop.fpsCap = 30;
    loop.start();
    [0, 16.7, 33.4, 50.1, 66.8].forEach(f.tick);
    expect(draws).toBe(3); // t = 0, 33.4, 66.8
  });

  it('stops drawing after stop()', () => {
    const f = fakeRaf();
    let draws = 0;
    const loop = new FrameLoop({ draw: () => draws++ }, f.raf, f.caf);
    loop.start();
    f.tick(0);
    loop.stop();
    f.tick(16.7);
    expect(draws).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/renderer/quality.ts`:
```ts
export interface Quality {
  /** Fraction of full canvas resolution, 0.5..1. */
  scale: number;
  fpsCap: 30 | 60;
}

const STEP = 0.1;
const MIN_SCALE = 0.5;
const RECOVER_WINDOWS = 5;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Watches frame times and sheds load before the phone's firmware does it for us:
 * resolution down in 0.1 steps to 0.5, then a 30fps cap. Resolution recovers
 * while still at 60fps; the 30fps cap never lifts within a session (prevents
 * flapping, because at a 30fps cap frame times always look "healthy").
 */
export class ThermalGuard {
  quality: Quality = { scale: 1, fpsCap: 60 };
  private sum = 0;
  private count = 0;
  private okStreak = 0;

  constructor(private windowSize = 60) {}

  push(frameMs: number): Quality {
    this.sum += frameMs;
    this.count++;
    if (this.count < this.windowSize) return this.quality;

    const avg = this.sum / this.count;
    this.sum = 0;
    this.count = 0;

    const q = this.quality;
    const budget = 1000 / q.fpsCap;
    if (avg > budget * 1.3) {
      this.okStreak = 0;
      if (q.scale > MIN_SCALE + 1e-9) this.quality = { ...q, scale: round1(q.scale - STEP) };
      else if (q.fpsCap === 60) this.quality = { scale: q.scale, fpsCap: 30 };
    } else if (avg < budget * 1.05 && q.fpsCap === 60 && q.scale < 1) {
      if (++this.okStreak >= RECOVER_WINDOWS) {
        this.okStreak = 0;
        this.quality = { ...q, scale: round1(Math.min(1, q.scale + STEP)) };
      }
    } else {
      this.okStreak = 0;
    }
    return this.quality;
  }
}
```

`src/renderer/frame-loop.ts`:
```ts
export interface LoopHooks {
  draw(): void;
  onFrameTime?(ms: number): void;
}

type Raf = (cb: (t: number) => void) => number;
type Caf = (id: number) => void;

export class FrameLoop {
  fpsCap: 30 | 60 = 60;
  private id = 0;
  private lastDraw = -1;
  private running = false;

  constructor(
    private hooks: LoopHooks,
    private raf: Raf = (cb) => requestAnimationFrame(cb),
    private caf: Caf = (id) => cancelAnimationFrame(id),
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.lastDraw = -1;
    this.id = this.raf(this.tick);
  }

  stop() {
    this.running = false;
    this.caf(this.id);
  }

  private tick = (t: number) => {
    if (!this.running) return;
    this.id = this.raf(this.tick);
    const minGap = 1000 / this.fpsCap - 2; // tolerate vsync jitter
    if (this.lastDraw >= 0 && t - this.lastDraw < minGap) return;
    if (this.lastDraw >= 0) this.hooks.onFrameTime?.(t - this.lastDraw);
    this.lastDraw = t;
    this.hooks.draw();
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/renderer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer
git commit -m "feat(renderer): thermal guard and capped frame loop"
```

---

### Task 5: Output channel protocol

**Files:**
- Create: `src/output/protocol.ts`
- Test: `src/output/protocol.test.ts`

**Interfaces:**
- Consumes: `Corners`, `Vec2`.
- Produces: `const CHANNEL = 'hypermapping'`; `type Msg = { type: 'hello' } | { type: 'state'; corners: Corners } | { type: 'video'; blob: Blob }`; `parseMsg(data: unknown): Msg | null`.

- [ ] **Step 1: Write the failing test**

`src/output/protocol.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseMsg, CHANNEL } from './protocol';

const corners = { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] };

describe('parseMsg', () => {
  it('uses a stable channel name', () => {
    expect(CHANNEL).toBe('hypermapping');
  });
  it('accepts hello', () => {
    expect(parseMsg({ type: 'hello' })).toEqual({ type: 'hello' });
  });
  it('accepts a well-formed state message', () => {
    expect(parseMsg({ type: 'state', corners })).toEqual({ type: 'state', corners });
  });
  it('rejects state with a missing corner', () => {
    expect(parseMsg({ type: 'state', corners: { tl: [0, 0] } })).toBeNull();
  });
  it('rejects state with non-finite numbers', () => {
    expect(parseMsg({ type: 'state', corners: { ...corners, tl: [NaN, 0] } })).toBeNull();
  });
  it('accepts a video message carrying a Blob', () => {
    const blob = new Blob(['x']);
    expect(parseMsg({ type: 'video', blob })).toEqual({ type: 'video', blob });
  });
  it('rejects video without a Blob', () => {
    expect(parseMsg({ type: 'video', blob: 'nope' })).toBeNull();
  });
  it('rejects unknown types and non-objects', () => {
    expect(parseMsg({ type: 'wat' })).toBeNull();
    expect(parseMsg('hello')).toBeNull();
    expect(parseMsg(null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/output`
Expected: FAIL — `./protocol` not found.

- [ ] **Step 3: Implement**

`src/output/protocol.ts`:
```ts
import type { Corners, Vec2 } from '../warp/types';

export const CHANNEL = 'hypermapping';

export type Msg =
  | { type: 'hello' } // output window -> editor: "send me everything you have"
  | { type: 'state'; corners: Corners } // editor -> output
  | { type: 'video'; blob: Blob }; // editor -> output (structured-clone copy)

const isVec2 = (v: unknown): v is Vec2 =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Validate anything that arrives on the channel; never trust the wire. */
export function parseMsg(data: unknown): Msg | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  switch (d.type) {
    case 'hello':
      return { type: 'hello' };
    case 'state': {
      const c = d.corners as Record<string, unknown> | undefined;
      if (c && isVec2(c.tl) && isVec2(c.tr) && isVec2(c.br) && isVec2(c.bl)) {
        return { type: 'state', corners: { tl: c.tl, tr: c.tr, br: c.br, bl: c.bl } };
      }
      return null;
    }
    case 'video':
      return d.blob instanceof Blob ? { type: 'video', blob: d.blob } : null;
    default:
      return null;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run src/output`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/output
git commit -m "feat(output): validated BroadcastChannel protocol"
```

---

### Task 6: Renderer interface, pure helpers, and the WebGL2 renderer

**Files:**
- Create: `src/renderer/types.ts`, `src/renderer/fit.ts`, `src/renderer/video-ready.ts`, `src/renderer/backends.ts`, `src/renderer/webgl2.ts`
- Test: `src/renderer/fit.test.ts`, `src/renderer/video-ready.test.ts`, `src/renderer/backends.test.ts`

**Interfaces:**
- Consumes: `FrameLoop`, `buildTopology`, `warpedPositions`, `GRID`, `UNIT_CORNERS`, `Corners`.
- Produces:
  - `interface Renderer { readonly kind: 'webgpu' | 'webgl2'; onFrameTime: ((ms: number) => void) | null; setCorners(c: Corners): void; setVideo(v: HTMLVideoElement | null): void; setFpsCap(cap: 30 | 60): void; start(): void; stop(): void; destroy(): void }`
  - `computeBackingSize(cssW: number, cssH: number, dpr: number, scale: number): { w: number; h: number }`
  - `isVideoReady(v: Pick<HTMLVideoElement, 'readyState' | 'videoWidth' | 'videoHeight'>): boolean`
  - `type Backend = 'webgpu' | 'webgl2'`; `chooseBackends(opts: { forced?: string | null; hasWebGPU: boolean }): Backend[]`
  - `createWebGL2Renderer(canvas: HTMLCanvasElement): Renderer`

- [ ] **Step 1: Write the failing tests**

`src/renderer/fit.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { computeBackingSize } from './fit';

describe('computeBackingSize', () => {
  it('multiplies css size by dpr (capped at 2) and scale', () => {
    expect(computeBackingSize(400, 800, 3, 1)).toEqual({ w: 800, h: 1600 });
    expect(computeBackingSize(400, 800, 3, 0.5)).toEqual({ w: 400, h: 800 });
    expect(computeBackingSize(1000, 500, 1, 0.5)).toEqual({ w: 500, h: 250 });
  });
  it('never returns zero or more than 4096', () => {
    expect(computeBackingSize(0, 0, 2, 1)).toEqual({ w: 1, h: 1 });
    expect(computeBackingSize(5000, 100, 2, 1)).toEqual({ w: 4096, h: 200 });
  });
  it('treats a bad dpr as 1', () => {
    expect(computeBackingSize(100, 100, 0, 1)).toEqual({ w: 100, h: 100 });
  });
});
```

`src/renderer/video-ready.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { isVideoReady } from './video-ready';

describe('isVideoReady', () => {
  it('is true once a frame is available and the video has size', () => {
    expect(isVideoReady({ readyState: 4, videoWidth: 1920, videoHeight: 1080 })).toBe(true);
    expect(isVideoReady({ readyState: 2, videoWidth: 640, videoHeight: 360 })).toBe(true);
  });
  it('is false while still loading metadata only', () => {
    expect(isVideoReady({ readyState: 1, videoWidth: 1920, videoHeight: 1080 })).toBe(false);
  });
  it('is false for a zero-sized video', () => {
    expect(isVideoReady({ readyState: 4, videoWidth: 0, videoHeight: 0 })).toBe(false);
  });
});
```

`src/renderer/backends.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { chooseBackends } from './backends';

describe('chooseBackends', () => {
  it('prefers WebGPU then WebGL2 when WebGPU exists', () => {
    expect(chooseBackends({ hasWebGPU: true })).toEqual(['webgpu', 'webgl2']);
  });
  it('uses only WebGL2 when WebGPU is missing', () => {
    expect(chooseBackends({ hasWebGPU: false })).toEqual(['webgl2']);
  });
  it('honours a forced backend exclusively so failures are visible', () => {
    expect(chooseBackends({ forced: 'webgl2', hasWebGPU: true })).toEqual(['webgl2']);
    expect(chooseBackends({ forced: 'webgpu', hasWebGPU: false })).toEqual(['webgpu']);
  });
  it('ignores an unknown forced value', () => {
    expect(chooseBackends({ forced: 'banana', hasWebGPU: true })).toEqual(['webgpu', 'webgl2']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/renderer`
Expected: FAIL — `./fit`, `./video-ready`, `./backends` not found.

- [ ] **Step 3: Implement the pure helpers**

`src/renderer/types.ts`:
```ts
import type { Corners } from '../warp/types';

export interface Renderer {
  readonly kind: 'webgpu' | 'webgl2';
  /** Called with ms between drawn frames; wire to ThermalGuard. */
  onFrameTime: ((ms: number) => void) | null;
  /** Corners in unit space (0..1, Y down). Invalid quads are ignored. */
  setCorners(corners: Corners): void;
  setVideo(video: HTMLVideoElement | null): void;
  setFpsCap(cap: 30 | 60): void;
  start(): void;
  stop(): void;
  destroy(): void;
}
```

`src/renderer/fit.ts`:
```ts
const MAX_PX = 4096;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Canvas backing-store size for a CSS box, device pixel ratio, and quality scale. */
export function computeBackingSize(cssW: number, cssH: number, dpr: number, scale: number) {
  const d = clamp(Number.isFinite(dpr) && dpr > 0 ? dpr : 1, 1, 2);
  return {
    w: clamp(Math.round(cssW * d * scale), 1, MAX_PX),
    h: clamp(Math.round(cssH * d * scale), 1, MAX_PX),
  };
}
```

`src/renderer/video-ready.ts`:
```ts
/** HAVE_CURRENT_DATA (2) or better, with real dimensions. */
export function isVideoReady(v: Pick<HTMLVideoElement, 'readyState' | 'videoWidth' | 'videoHeight'>): boolean {
  return v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0;
}
```

`src/renderer/backends.ts`:
```ts
export type Backend = 'webgpu' | 'webgl2';

export function chooseBackends(opts: { forced?: string | null; hasWebGPU: boolean }): Backend[] {
  if (opts.forced === 'webgl2') return ['webgl2'];
  if (opts.forced === 'webgpu') return ['webgpu'];
  return opts.hasWebGPU ? ['webgpu', 'webgl2'] : ['webgl2'];
}
```

- [ ] **Step 4: Implement the WebGL2 renderer**

`src/renderer/webgl2.ts`:
```ts
import { GRID, buildTopology, warpedPositions } from '../warp/mesh';
import { UNIT_CORNERS, type Corners } from '../warp/types';
import { FrameLoop } from './frame-loop';
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
    throw new Error(`Shader compile failed: ${gl.getShaderInfoLog(s)}`);
  }
  return s;
}

export function createWebGL2Renderer(canvas: HTMLCanvasElement): Renderer {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('WebGL2 is not available');

  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(`Program link failed: ${gl.getProgramInfoLog(program)}`);
  }
  gl.useProgram(program);

  const topo = buildTopology();
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  const posBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, topo.vertexCount * 2 * 4, gl.DYNAMIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uvBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
  gl.bufferData(gl.ARRAY_BUFFER, topo.uvs, gl.STATIC_DRAW);
  const aUv = gl.getAttribLocation(program, 'a_uv');
  gl.enableVertexAttribArray(aUv);
  gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

  const idxBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, topo.indices, gl.STATIC_DRAW);

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(gl.getUniformLocation(program, 'u_tex'), 0);

  const positions = new Float32Array(topo.vertexCount * 2);
  let dirty = false;
  let video: HTMLVideoElement | null = null;

  const setCorners = (c: Corners) => {
    if (warpedPositions(c, GRID, GRID, positions)) dirty = true; // invalid quad: keep previous
  };
  setCorners(UNIT_CORNERS);

  const draw = () => {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(vao);
    if (dirty) {
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
      dirty = false;
    }
    if (!video || !isVideoReady(video)) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.drawElements(gl.TRIANGLES, topo.indices.length, gl.UNSIGNED_SHORT, 0);
  };

  const loop = new FrameLoop({ draw, onFrameTime: (ms) => renderer.onFrameTime?.(ms) });

  const renderer: Renderer = {
    kind: 'webgl2',
    onFrameTime: null,
    setCorners,
    setVideo: (v) => {
      video = v;
    },
    setFpsCap: (cap) => {
      loop.fpsCap = cap;
    },
    start: () => loop.start(),
    stop: () => loop.stop(),
    destroy: () => {
      // Deliberately does not lose the context: the canvas may be reused.
      loop.stop();
      gl.deleteTexture(tex);
      gl.deleteBuffer(posBuf);
      gl.deleteBuffer(uvBuf);
      gl.deleteBuffer(idxBuf);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    },
  };
  return renderer;
}
```

- [ ] **Step 5: Run tests and typecheck**

Run: `npx vitest run src/renderer && npx tsc --noEmit`
Expected: all renderer tests PASS; `tsc` reports no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer
git commit -m "feat(renderer): Renderer interface, pure helpers, WebGL2 backend"
```

---

### Task 7: WebGPU renderer and the backend factory

**Files:**
- Create: `src/renderer/webgpu.ts`, `src/renderer/index.ts`

**Interfaces:**
- Consumes: `Renderer`, `FrameLoop`, `buildTopology`, `warpedPositions`, `GRID`, `UNIT_CORNERS`, `isVideoReady`, `chooseBackends`, `createWebGL2Renderer`.
- Produces: `createWebGPURenderer(canvas: HTMLCanvasElement): Promise<Renderer>`; `createRenderer(canvas: HTMLCanvasElement, forced?: string | null): Promise<Renderer>` (reads `?renderer=webgl2|webgpu` from the URL when `forced` is `undefined`).

No unit tests exist for GPU code (no GPU in Node). The pure selection logic is already covered by `backends.test.ts`; this task is verified by typecheck here and on a real device in Task 10.

- [ ] **Step 1: Implement the WebGPU renderer**

`src/renderer/webgpu.ts`:
```ts
import { GRID, buildTopology, warpedPositions } from '../warp/mesh';
import { UNIT_CORNERS, type Corners } from '../warp/types';
import { FrameLoop } from './frame-loop';
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

export async function createWebGPURenderer(canvas: HTMLCanvasElement): Promise<Renderer> {
  if (!navigator.gpu) throw new Error('WebGPU is not available');
  // Acquire the device BEFORE touching the canvas: once getContext('webgpu') has
  // succeeded the canvas can no longer give out a WebGL2 context for the fallback.
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice();
  device.lost.then((info) => console.warn('[hypermapping] WebGPU device lost:', info.message));

  const ctx = canvas.getContext('webgpu');
  if (!ctx) throw new Error('Could not get a WebGPU canvas context');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  const topo = buildTopology();
  const positions = new Float32Array(topo.vertexCount * 2);

  const posBuf = device.createBuffer({
    label: 'warp positions',
    size: positions.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  const uvBuf = device.createBuffer({
    label: 'warp uvs',
    size: topo.uvs.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  const idxBuf = device.createBuffer({
    label: 'warp indices',
    size: topo.indices.byteLength, // 4800 bytes, a multiple of 4
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uvBuf, 0, topo.uvs);
  device.queue.writeBuffer(idxBuf, 0, topo.indices);

  const module = device.createShaderModule({ code: WGSL });
  const pipeline = device.createRenderPipeline({
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
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

  let dirty = false;
  let video: HTMLVideoElement | null = null;

  const setCorners = (c: Corners) => {
    if (warpedPositions(c, GRID, GRID, positions)) dirty = true; // invalid quad: keep previous
  };
  setCorners(UNIT_CORNERS);

  const draw = () => {
    if (dirty) {
      device.queue.writeBuffer(posBuf, 0, positions);
      dirty = false;
    }
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
      // External textures are valid for one frame, so the bind group is rebuilt each draw.
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: device.importExternalTexture({ source: video }) },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, posBuf);
      pass.setVertexBuffer(1, uvBuf);
      pass.setIndexBuffer(idxBuf, 'uint16');
      pass.drawIndexed(topo.indices.length);
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
  };

  const loop = new FrameLoop({ draw, onFrameTime: (ms) => renderer.onFrameTime?.(ms) });

  const renderer: Renderer = {
    kind: 'webgpu',
    onFrameTime: null,
    setCorners,
    setVideo: (v) => {
      video = v;
    },
    setFpsCap: (cap) => {
      loop.fpsCap = cap;
    },
    start: () => loop.start(),
    stop: () => loop.stop(),
    destroy: () => {
      loop.stop();
      posBuf.destroy();
      uvBuf.destroy();
      idxBuf.destroy();
    },
  };
  return renderer;
}
```

- [ ] **Step 2: Implement the factory**

`src/renderer/index.ts`:
```ts
import { chooseBackends } from './backends';
import type { Renderer } from './types';
import { createWebGL2Renderer } from './webgl2';
import { createWebGPURenderer } from './webgpu';

export type { Renderer } from './types';
export { ThermalGuard, type Quality } from './quality';
export { computeBackingSize } from './fit';

/**
 * Pick the best backend. `?renderer=webgl2` or `?renderer=webgpu` in the URL
 * forces exactly one (failures are then visible instead of silently falling back).
 */
export async function createRenderer(
  canvas: HTMLCanvasElement,
  forced: string | null = new URLSearchParams(location.search).get('renderer'),
): Promise<Renderer> {
  const order = chooseBackends({ forced, hasWebGPU: 'gpu' in navigator });
  const errors: string[] = [];
  for (const backend of order) {
    try {
      return backend === 'webgpu' ? await createWebGPURenderer(canvas) : createWebGL2Renderer(canvas);
    } catch (e) {
      console.warn(`[hypermapping] ${backend} failed`, e);
      errors.push(`${backend}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`No usable graphics backend (${errors.join('; ')})`);
}
```

- [ ] **Step 3: Typecheck and run all tests**

Run: `npx tsc --noEmit && npm test`
Expected: no type errors; every test passes.

- [ ] **Step 4: Commit**

```bash
git add src/renderer
git commit -m "feat(renderer): WebGPU backend and auto-selecting factory"
```

---

### Task 8: Video source, renderer hook, pin overlay, and the Editor

**Files:**
- Create: `src/sources/video.ts`, `src/ui/useRenderer.ts`, `src/ui/PinOverlay.tsx`, `src/ui/Editor.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `createRenderer`, `ThermalGuard`, `computeBackingSize`, `Renderer`, `Quality`, `isValidQuad`, `clampCorner`, `Corners`, `CHANNEL`, `parseMsg`.
- Produces:
  - `createVideoFromBlob(blob: Blob): Promise<VideoHandle>` and `interface VideoHandle { video: HTMLVideoElement; dispose(): void }`
  - `useRenderer(canvasRef: RefObject<HTMLCanvasElement>): { renderer: Renderer | null; error: string | null; quality: Quality }`
  - `<PinOverlay cornersRef onChange />` where `onChange(next: Corners): boolean` returns `true` when accepted
  - `<Editor />`

UI wiring has no unit tests; it is verified manually in Task 10 and by typecheck/build here.

- [ ] **Step 1: Video source**

`src/sources/video.ts`:
```ts
export interface VideoHandle {
  video: HTMLVideoElement;
  dispose(): void;
}

/**
 * Turn a picked file/blob into a looping, muted, inline <video>. Muted +
 * playsInline are what let it autoplay on phones. Rejects if the browser cannot
 * decode the file so the UI can show a message instead of a black screen.
 */
export async function createVideoFromBlob(blob: Blob): Promise<VideoHandle> {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.setAttribute('playsinline', '');
  video.preload = 'auto';
  video.src = url;

  const dispose = () => {
    video.pause();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  };

  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error('This browser could not decode that video'));
    });
    await video.play().catch(() => {
      /* autoplay refused: first tap will start it */
    });
  } catch (e) {
    dispose();
    throw e;
  }
  return { video, dispose };
}
```

- [ ] **Step 2: Renderer hook**

`src/ui/useRenderer.ts`:
```ts
import { useEffect, useState, type RefObject } from 'react';
import { ThermalGuard, computeBackingSize, createRenderer, type Quality, type Renderer } from '../renderer';

/** Owns the renderer's lifetime, canvas sizing, and the thermal guard. */
export function useRenderer(canvasRef: RefObject<HTMLCanvasElement>) {
  const [renderer, setRenderer] = useState<Renderer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [quality, setQuality] = useState<Quality>({ scale: 1, fpsCap: 60 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let active: Renderer | null = null;
    let scale = 1;
    const guard = new ThermalGuard();

    const fit = () => {
      const { w, h } = computeBackingSize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio, scale);
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
    };
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    fit();

    createRenderer(canvas)
      .then((r) => {
        if (disposed) {
          r.destroy();
          return;
        }
        active = r;
        r.onFrameTime = (ms) => {
          const q = guard.push(ms);
          if (q.scale !== scale) {
            scale = q.scale;
            fit();
          }
          r.setFpsCap(q.fpsCap);
          setQuality((prev) => (prev.scale === q.scale && prev.fpsCap === q.fpsCap ? prev : q));
        };
        r.start();
        setRenderer(r);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));

    return () => {
      disposed = true;
      observer.disconnect();
      active?.destroy();
    };
  }, [canvasRef]);

  return { renderer, error, quality };
}
```

- [ ] **Step 3: Pin overlay**

`src/ui/PinOverlay.tsx`:
```tsx
import { useCallback, useLayoutEffect, useRef, type MutableRefObject, type PointerEvent } from 'react';
import { clampCorner } from '../warp/quad';
import type { Corners } from '../warp/types';

const IDS = ['tl', 'tr', 'br', 'bl'] as const;
type CornerId = (typeof IDS)[number];

interface Props {
  cornersRef: MutableRefObject<Corners>;
  /** Return true if the quad was accepted. Rejected moves leave the pin where it was. */
  onChange: (next: Corners) => boolean;
}

/**
 * Four draggable pins over the canvas. Positions are painted by mutating the
 * SVG attributes directly: a pointermove never causes a React render.
 */
export function PinOverlay({ cornersRef, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const circles = useRef<Partial<Record<CornerId, SVGCircleElement | null>>>({});
  const outline = useRef<SVGPolygonElement>(null);
  const dragging = useRef<CornerId | null>(null);

  const paint = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const c = cornersRef.current;
    for (const id of IDS) {
      const el = circles.current[id];
      if (!el) continue;
      el.setAttribute('cx', String(c[id][0] * rect.width));
      el.setAttribute('cy', String(c[id][1] * rect.height));
    }
    outline.current?.setAttribute(
      'points',
      IDS.map((id) => `${c[id][0] * rect.width},${c[id][1] * rect.height}`).join(' '),
    );
  }, [cornersRef]);

  useLayoutEffect(() => {
    paint();
    const observer = new ResizeObserver(paint);
    if (svgRef.current) observer.observe(svgRef.current);
    return () => observer.disconnect();
  }, [paint]);

  const onDown = (id: CornerId) => (e: PointerEvent<SVGCircleElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = id;
  };

  const onMove = (id: CornerId) => (e: PointerEvent<SVGCircleElement>) => {
    if (dragging.current !== id || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const p = clampCorner([(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height]);
    const next: Corners = { ...cornersRef.current, [id]: p };
    if (onChange(next)) paint();
  };

  const onUp = (e: PointerEvent<SVGCircleElement>) => {
    dragging.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <svg ref={svgRef} className="pointer-events-none absolute inset-0 z-10 h-full w-full">
      <polygon ref={outline} className="fill-cyan-400/10 stroke-cyan-400" strokeWidth={2} />
      {IDS.map((id) => (
        <circle
          key={id}
          ref={(el) => {
            circles.current[id] = el;
          }}
          r={28}
          className="pointer-events-auto cursor-pointer touch-none fill-white/30 stroke-cyan-400"
          strokeWidth={3}
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

- [ ] **Step 4: Editor**

`src/ui/Editor.tsx`:
```tsx
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { CHANNEL, parseMsg } from '../output/protocol';
import { createVideoFromBlob, type VideoHandle } from '../sources/video';
import { isValidQuad } from '../warp/quad';
import type { Corners } from '../warp/types';
import { PinOverlay } from './PinOverlay';
import { useRenderer } from './useRenderer';

const INITIAL: Corners = { tl: [0.2, 0.2], tr: [0.8, 0.2], br: [0.8, 0.8], bl: [0.2, 0.8] };

export function Editor() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { renderer, error, quality } = useRenderer(canvasRef);
  const cornersRef = useRef<Corners>(INITIAL);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const videoRef = useRef<VideoHandle | null>(null);
  const blobRef = useRef<Blob | null>(null);
  const [mode, setMode] = useState<'edit' | 'play'>('edit');
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    renderer?.setCorners(cornersRef.current);
  }, [renderer]);

  useEffect(() => {
    const ch = new BroadcastChannel(CHANNEL);
    channelRef.current = ch;
    ch.onmessage = (ev) => {
      if (parseMsg(ev.data)?.type !== 'hello') return;
      // A new output window asked for everything we have.
      ch.postMessage({ type: 'state', corners: cornersRef.current });
      if (blobRef.current) ch.postMessage({ type: 'video', blob: blobRef.current });
    };
    return () => {
      ch.close();
      channelRef.current = null;
      videoRef.current?.dispose();
    };
  }, []);

  const onCornersChange = useCallback(
    (next: Corners) => {
      if (!isValidQuad(next)) return false;
      cornersRef.current = next;
      renderer?.setCorners(next);
      channelRef.current?.postMessage({ type: 'state', corners: next });
      return true;
    },
    [renderer],
  );

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
      setNotice(null);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Could not load that video');
    }
  };

  const openOutput = () => {
    window.open(`${location.pathname}#output`, 'hypermapping-output', 'popup,width=960,height=540');
  };

  return (
    <div className="fixed inset-0 touch-none select-none overflow-hidden bg-black text-white">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

      {mode === 'edit' && <PinOverlay cornersRef={cornersRef} onChange={onCornersChange} />}

      {mode === 'edit' ? (
        <div className="absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center gap-2 bg-black/70 p-3 text-sm backdrop-blur">
          <label
            className={`rounded-lg px-4 py-3 font-medium ${
              renderer ? 'cursor-pointer bg-cyan-500 text-black' : 'bg-zinc-700 text-zinc-400'
            }`}
          >
            Load video
            <input type="file" accept="video/*" className="hidden" disabled={!renderer} onChange={onFile} />
          </label>
          <button className="rounded-lg bg-zinc-700 px-4 py-3" onClick={() => setMode('play')}>
            Play mode
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
          onClick={() => setMode('edit')}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Route in App**

`src/App.tsx` (the `Output` view arrives in Task 9, so route only the editor now):
```tsx
import { Editor } from './ui/Editor';

export function App() {
  return <Editor />;
}
```

- [ ] **Step 6: Typecheck, test, build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: no type errors, all tests pass, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src
git commit -m "feat(ui): video source, renderer hook, pin overlay and editor with play mode"
```

---

### Task 9: Output window

**Files:**
- Create: `src/ui/Output.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useRenderer`, `CHANNEL`, `parseMsg`, `createVideoFromBlob`.
- Produces: `<Output />` — a clean fullscreen canvas that mirrors the editor's corners and video; route `#output`.

- [ ] **Step 1: Output view**

`src/ui/Output.tsx`:
```tsx
import { useEffect, useRef } from 'react';
import { CHANNEL, parseMsg } from '../output/protocol';
import { createVideoFromBlob, type VideoHandle } from '../sources/video';
import { useRenderer } from './useRenderer';

/** Projector view: nothing but the warped video. Click once to go fullscreen. */
export function Output() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { renderer, error } = useRenderer(canvasRef);

  useEffect(() => {
    if (!renderer) return;
    const ch = new BroadcastChannel(CHANNEL);
    let handle: VideoHandle | null = null;
    let latest = 0; // guards against out-of-order async video loads

    ch.onmessage = async (ev) => {
      const msg = parseMsg(ev.data);
      if (!msg) return;
      if (msg.type === 'state') {
        renderer.setCorners(msg.corners);
      } else if (msg.type === 'video') {
        const mine = ++latest;
        try {
          const next = await createVideoFromBlob(msg.blob);
          if (mine !== latest) {
            next.dispose();
            return;
          }
          handle?.dispose();
          handle = next;
          renderer.setVideo(next.video);
        } catch (e) {
          console.warn('[hypermapping] output could not load video', e);
        }
      }
    };
    ch.postMessage({ type: 'hello' });

    return () => {
      ch.close();
      handle?.dispose();
      renderer.setVideo(null);
    };
  }, [renderer]);

  return (
    <div
      className="fixed inset-0 cursor-none bg-black"
      onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}
    >
      <canvas ref={canvasRef} className="h-full w-full" />
      {error && <p className="absolute left-4 top-4 text-sm text-amber-400">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 2: Route**

`src/App.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { Editor } from './ui/Editor';
import { Output } from './ui/Output';

const isOutputHash = () => location.hash === '#output';

export function App() {
  const [output, setOutput] = useState(isOutputHash());
  useEffect(() => {
    const onHash = () => setOutput(isOutputHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return output ? <Output /> : <Editor />;
}
```

- [ ] **Step 3: Typecheck, test, build**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: no type errors, all tests pass, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src
git commit -m "feat(output): projector window mirrors editor corners and video"
```

---

### Task 10: README and real-device verification

**Files:**
- Create: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Write the README**

`README.md`:
```markdown
# HyperMapping

Web-first projection mapping for phones. Milestone 1: four-corner perspective pin + local video.

## Run

    npm install
    npm run dev        # https://<your-LAN-IP>:5173  (self-signed cert: accept the warning)
    npm test
    npm run build

HTTPS is required: WebGPU only exists in secure contexts. Plain `http://<LAN-IP>`
silently falls back to WebGL2. Android alternative: `adb reverse tcp:5173 tcp:5173`
then open `https://localhost:5173`.

## Use

- **Load video** picks a file from the phone. **Drag the four pins** onto the corners of your surface.
- **Play mode** hides every control (tap the invisible top-left square to come back).
- **Open output window** opens `#output` (desktop/tablet: drag it to the projector and click once for fullscreen).
- `?renderer=webgl2` or `?renderer=webgpu` forces a backend.

## Known limits (M1)

- A phone cannot use the output window as a second screen; it opens a tab. For a phone plugged into a
  projector over USB-C/HDMI, use Play mode (screen mirror). True extended display needs the native shell (later milestone).
- No saving yet (Milestone 2).
```

- [ ] **Step 2: Automated gate**

Run: `npm test && npm run build`
Expected: all tests pass, build succeeds.

- [ ] **Step 3: Desktop check**

Run: `npm run dev`, open `https://localhost:5173` in Chrome.
Expected, in order:
1. Bottom bar shows `webgpu · 100% · 60fps` (or `webgl2` if WebGPU is off).
2. Load a video: it plays inside the cyan quad.
3. Drag each pin: the video follows with no lag; dragging a pin past the opposite edge stops it at the last valid spot instead of breaking the picture.
4. Reload with `?renderer=webgl2`: bar shows `webgl2`, same behavior.
5. Click **Open output window**: a second window shows only the video, and moving a pin in the editor moves it there live. Closing and reopening the output window restores the current video and corners (the `hello` handshake).
6. **Play mode** hides all UI; tapping the top-left corner returns.

- [ ] **Step 4: Phone check**

Open `https://<LAN-IP>:5173` on the phone and accept the certificate warning.
Expected: same as steps 1-3 and 6 above using touch; pins are easy to grab with a thumb; the page never scrolls or zooms while dragging; rotating the phone keeps the picture sharp and correctly sized.

- [ ] **Step 5: Thermal check**

Play a 4K or 1080p video in Play mode for 20 minutes with the phone plugged into the projector. Keep the editor open once afterwards.
Expected: if the phone heats up, the status bar shows resolution dropping in 10% steps and, as a last resort, `30fps`, instead of the phone stuttering or crashing. Record the phone model and observed behavior in the README under a "Device notes" heading.

- [ ] **Step 6: Commit**

```bash
git add README.md
git commit -m "docs: README with run instructions and known limits"
```

---

## Self-Review

**Spec coverage (M1):** renderer interface + WebGPU/WebGL2 (Tasks 6-7); homography corner-pin, not bilinear (Tasks 2-3); local video (Task 8); output-only mode (Task 8 play mode) and `#output` window via BroadcastChannel (Tasks 5, 9); drag state in refs with pointer capture and `touch-none` (Task 8); thermal guard (Tasks 4, 8); NDC Y-flip (Task 3 `unitToNdc`); hard-coded verification items from the spec — unit tests for homography corners/straight lines/Y-flip (Tasks 2-3), forced-fallback flag (Task 7), 20-minute thermal run (Task 10). Scenes, mesh/bezier, generative, calibration and native shell are intentionally deferred to later plans.

**Placeholder scan:** none; every code step carries full code.

**Type consistency:** `Corners` (`tl,tr,br,bl`), `Renderer.setCorners(Corners)`, `warpedPositions(corners, cols, rows, out)`, `Quality {scale, fpsCap}`, `VideoHandle`, `Msg` and `parseMsg` use the same names in every task that touches them.

**Known risk to watch at execution time:** the "collinear destination returns null" test relies on the pivot threshold of 1e-12 treating a numerically singular matrix as singular; if it fails on the first run, tighten by also rejecting any result containing non-finite values.
