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
