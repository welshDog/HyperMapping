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
  const out = m.map((row, i) => row[n] / row[i]);
  return out.every(Number.isFinite) ? out : null;
}

// TODO(multi-surface/bezier): PRECONDITION. `h` MUST come from a quad that passed
// `isValidQuad`. Any new caller (bezier mask, multi-layer) must validate with
// `isValidQuad` first; otherwise w = h6*x + h7*y + h8 can hit 0 or change sign
// across the source square and the result is Infinity/NaN. This function is the
// unchecked hot path (mesh warping); use `applyHomographyChecked` when unsure.
export function applyHomography(h: Mat3, [x, y]: Vec2): Vec2 {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

/** Like `applyHomography` but returns null if w is non-finite or ~0, or the result is non-finite. */
export function applyHomographyChecked(h: Mat3, [x, y]: Vec2): Vec2 | null {
  const w = h[6] * x + h[7] * y + h[8];
  if (!Number.isFinite(w) || Math.abs(w) < 1e-12) return null;
  const u = (h[0] * x + h[1] * y + h[2]) / w;
  const v = (h[3] * x + h[4] * y + h[5]) / w;
  return Number.isFinite(u) && Number.isFinite(v) ? [u, v] : null;
}
