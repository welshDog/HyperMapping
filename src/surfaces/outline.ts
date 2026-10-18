import { applyHomography, computeHomography } from '../warp/homography';
import { UNIT_CORNERS, cornersToArray, type Corners, type Vec2 } from '../warp/types';
import type { FaceShape } from './types';

/**
 * The shape's edge as points in canvas space (0..1), found by pushing points of the unit frame through the
 * same homography that warps the face. Quads give their four corners (tl, tr, br, bl); a triangle gives apex,
 * base-right, base-left; a circle gives `segments` points around the inscribed ellipse.
 * Empty when the frame has no valid warp.
 */
export function shapeOutlinePoints(shape: FaceShape, corners: Corners, segments = 48): Vec2[] {
  if (shape === 'quad') return cornersToArray(corners).map((p) => [p[0], p[1]] as Vec2);
  const h = computeHomography(cornersToArray(UNIT_CORNERS), cornersToArray(corners));
  if (!h) return [];
  const frame: Vec2[] =
    shape === 'triangle'
      ? [[0.5, 0], [1, 1], [0, 1]]
      : Array.from({ length: segments }, (_, i) => {
          const t = (i / segments) * Math.PI * 2;
          return [0.5 + 0.5 * Math.cos(t), 0.5 + 0.5 * Math.sin(t)] as Vec2;
        });
  const out = frame.map((p) => applyHomography(h, p));
  return out.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)) ? out : [];
}
