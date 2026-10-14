import { defaultSlices } from '../surfaces/model';
import { MAX_SURFACES, type Surface } from '../surfaces/types';
import { isValidQuad } from '../warp/quad';
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

/** 'degenerate' = edge-on or too small to map (the app would reject the quad). */
export type SkipReason = 'facing-away' | 'behind-projector' | 'off-image' | 'degenerate';

export interface SolvedFace {
  face: FaceId;
  corners: Corners;
  /** Mean of the projected corners; the facing test uses the 3D face centre. */
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
    const corners = orderClockwise(pts);
    if (!isValidQuad(corners)) {
      result.skipped.push({ face: face.id, reason: 'degenerate' });
      continue;
    }
    result.faces.push({
      face: face.id,
      corners,
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
