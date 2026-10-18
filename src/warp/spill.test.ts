import { describe, it, expect } from 'vitest';
import { shapeOutlinePoints } from '../surfaces/outline';
import type { FaceShape } from '../surfaces/types';
import { GRID, buildTopology, frameCoords, warpedPositions } from './mesh';
import { meshMargin, shapeDistance } from './shape';
import type { Corners } from './types';

const W = 640;
const H = 360;

/** Pixels the shader would call inside the shape (interpolated frame coords, straight in screen space like the GPU). */
function litPixels(corners: Corners, shape: FaceShape): Uint8Array {
  const m = meshMargin(shape);
  const topo = buildTopology(GRID, GRID, m);
  const p = warpedPositions(corners, GRID, GRID, undefined, m)!;
  const f = frameCoords(GRID, GRID, m, shape);
  const lit = new Uint8Array(W * H);
  const idx = topo.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const v = [idx[t], idx[t + 1], idx[t + 2]];
    const P = v.map((i) => [((p[2 * i] + 1) / 2) * W, ((1 - p[2 * i + 1]) / 2) * H]);
    const F = v.map((i) => [f[3 * i], f[3 * i + 1]]);
    const d = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
    if (Math.abs(d) < 1e-9) continue;
    const minx = Math.max(0, Math.floor(Math.min(...P.map((q) => q[0]))));
    const maxx = Math.min(W - 1, Math.ceil(Math.max(...P.map((q) => q[0]))));
    const miny = Math.max(0, Math.floor(Math.min(...P.map((q) => q[1]))));
    const maxy = Math.min(H - 1, Math.ceil(Math.max(...P.map((q) => q[1]))));
    for (let y = miny; y <= maxy; y++)
      for (let x = minx; x <= maxx; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const a = ((P[1][0] - px) * (P[2][1] - py) - (P[2][0] - px) * (P[1][1] - py)) / d;
        const b = ((P[2][0] - px) * (P[0][1] - py) - (P[0][0] - px) * (P[2][1] - py)) / d;
        const g = 1 - a - b;
        if (a < 0 || b < 0 || g < 0) continue;
        const fx = a * F[0][0] + b * F[1][0] + g * F[2][0];
        const fy = a * F[0][1] + b * F[1][1] + g * F[2][1];
        if (shapeDistance(shape, fx, fy) < 0) lit[y * W + x] = 1;
      }
  }
  return lit;
}

const segDist = (px: number, py: number, a: number[], b: number[]) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - a[0] - t * dx, py - a[1] - t * dy);
};
const inPoly = (px: number, py: number, poly: number[][]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};

/** The worst distance (px) any lit pixel is outside the true outline of the shape. */
function worstSpill(corners: Corners, shape: FaceShape): number {
  const lit = litPixels(corners, shape);
  const poly = shapeOutlinePoints(shape, corners, 360).map(([x, y]) => [x * W, y * H]);
  let worst = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (!lit[y * W + x]) continue;
      const px = x + 0.5;
      const py = y + 0.5;
      if (inPoly(px, py, poly)) continue;
      let dist = Infinity;
      for (let i = 0; i < poly.length; i++) dist = Math.min(dist, segDist(px, py, poly[i], poly[(i + 1) % poly.length]));
      worst = Math.max(worst, dist);
    }
  return worst;
}

// A triangle's edges run along mesh lines, so it never spills. A circle's curved edge falls inside grid cells whose
// colour is interpolated in a straight line on screen (not with perspective), so it can spill a little on a very
// foreshortened frame (not caused by the margin: it happens at margin 0 too). Perspective-correct interpolation
// would remove it; until then these are the measured limits (px, on a 640 px wide canvas) so they cannot get worse.
const CIRCLE_LIMIT_PX: Record<number, number> = { 0.3: 1.5, 0.1: 3, 0.05: 7 };

describe('no light past a shape, even on a strongly foreshortened frame', () => {
  for (const top of [0.3, 0.1, 0.05]) {
    const frame: Corners = { tl: [0.5 - top / 2, 0.2], tr: [0.5 + top / 2, 0.2], br: [0.8, 0.8], bl: [0.2, 0.8] };
    it(`triangle, top edge ${top} of the canvas wide vs 0.6 at the bottom`, () => {
      expect(worstSpill(frame, 'triangle')).toBeLessThan(1.5);
    });
    it(`circle, top edge ${top} of the canvas wide vs 0.6 at the bottom`, () => {
      expect(worstSpill(frame, 'circle')).toBeLessThan(CIRCLE_LIMIT_PX[top]);
    });
  }
});
