import { isValidQuad } from '../warp/quad';
import type { Corners, Vec2 } from '../warp/types';
import type { Surface } from '../surfaces/types';
import type { ScanMap } from './decode';
import { STEP_PX } from './patterns';

/** Camera pixels (of the analysis image) around a tap that are used to read the projector position. */
export const TAP_RADIUS_PX = 8;

/** Solve for `a` in z = a + b*dx + c*dy by least squares. Returns null when the points are collinear. */
function planeAtOrigin(
  n: number,
  sx: number,
  sy: number,
  sxx: number,
  sxy: number,
  syy: number,
  sz: number,
  sxz: number,
  syz: number,
): number | null {
  // Cramer's rule on [[n,sx,sy],[sx,sxx,sxy],[sy,sxy,syy]] * [a,b,c] = [sz,sxz,syz].
  const det3 = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const det = det3([
    [n, sx, sy],
    [sx, sxx, sxy],
    [sy, sxy, syy],
  ]);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-6) return null;
  const detA = det3([
    [sz, sx, sy],
    [sxz, sxx, sxy],
    [syz, sxy, syy],
  ]);
  return detA / det;
}

/**
 * The projector pixel a camera tap lands on: a plane is fitted to the decoded cells around the tap
 * (which smooths the 4-pixel steps) and read off at the tap. Null when too little of the disc around
 * the tap is reliably lit.
 */
export function projectorPointAt(map: ScanMap, cx: number, cy: number, radius = TAP_RADIUS_PX, minValid = 0.5): Vec2 | null {
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(map.width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(map.height - 1, Math.ceil(cy + radius));
  let total = 0;
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let szx = 0;
  let sxzx = 0;
  let syzx = 0;
  let szy = 0;
  let sxzy = 0;
  let syzy = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      total++;
      const p = y * map.width + x;
      if (!map.mask[p]) continue;
      n++;
      sx += dx;
      sy += dy;
      sxx += dx * dx;
      sxy += dx * dy;
      syy += dy * dy;
      const zx = map.mapX[p];
      const zy = map.mapY[p];
      szx += zx;
      sxzx += dx * zx;
      syzx += dy * zx;
      szy += zy;
      sxzy += dx * zy;
      syzy += dy * zy;
    }
  }
  if (total === 0 || n < 6 || n / total < minValid) return null;
  const ax = planeAtOrigin(n, sx, sy, sxx, sxy, syy, szx, sxzx, syzx);
  const ay = planeAtOrigin(n, sx, sy, sxx, sxy, syy, szy, sxzy, syzy);
  if (ax === null || ay === null) return null;
  return [(ax + 0.5) * STEP_PX, (ay + 0.5) * STEP_PX];
}

export type TapResult =
  | { ok: true; corners: Corners }
  | { ok: false; failed: number[]; reason: 'unlit' | 'invalid-quad' };

/**
 * Four camera taps (tl, tr, br, bl) to a face's corners in unit space. `failed` names the taps that
 * could not be read (reason 'unlit'); when all four read but the quad is bent or collapsed the reason
 * is 'invalid-quad' and `failed` is empty.
 */
export function tapsToCorners(map: ScanMap, taps: [Vec2, Vec2, Vec2, Vec2], projector: { w: number; h: number }): TapResult {
  const points: Vec2[] = [];
  const failed: number[] = [];
  taps.forEach((t, i) => {
    const p = projectorPointAt(map, t[0], t[1]);
    if (p) points.push([p[0] / projector.w, p[1] / projector.h]);
    else failed.push(i);
  });
  if (failed.length > 0) return { ok: false, failed, reason: 'unlit' };
  const corners: Corners = { tl: points[0], tr: points[1], br: points[2], bl: points[3] };
  if (!isValidQuad(corners)) return { ok: false, failed: [], reason: 'invalid-quad' };
  return { ok: true, corners };
}

/** Replace the corners of the faces in `results`; everything else (other faces, slices, ids) is untouched. */
export function applyCalibration(surfaces: Surface[], results: Record<string, Corners>): Surface[] {
  return surfaces.map((s) => {
    const c = Object.prototype.hasOwnProperty.call(results, s.id) ? results[s.id] : undefined;
    if (!c) return s;
    return { ...s, corners: { tl: [...c.tl], tr: [...c.tr], br: [...c.br], bl: [...c.bl] } };
  });
}

/** A click on the shown camera picture to camera analysis pixels; null outside the picture. */
export function tapToCamera(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  camW: number,
  camH: number,
): Vec2 | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  const u = (clientX - rect.left) / rect.width;
  const v = (clientY - rect.top) / rect.height;
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null;
  return [u * camW, v * camH];
}
