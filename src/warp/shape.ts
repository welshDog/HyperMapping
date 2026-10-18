import type { FaceShape } from '../surfaces/types';

/** How far (in frame units) a shaped face's mesh extends past its frame, so the shape's edge can be anti-aliased. */
export const SHAPE_MARGIN = 0.02;

/** The numbers the shaders use to pick a shape. Keep in step with the GLSL and WGSL. */
export const shapeId = (s: FaceShape): 0 | 1 | 2 => (s === 'triangle' ? 1 : s === 'circle' ? 2 : 0);

/** Quads draw exactly their frame; shaped faces draw a little beyond it. */
export const meshMargin = (s: FaceShape): number => (s === 'quad' ? 0 : SHAPE_MARGIN);

const INV_EDGE = 1 / Math.sqrt(1.25);

/**
 * Signed distance, in frame units, from the frame point (fx, fy) (0..1, y down) to the shape's edge:
 * negative inside, zero on the edge, positive outside. Quads are always inside.
 * The GLSL (webgl2.ts) and WGSL (webgpu.ts) fragment shaders mirror this exactly; change all three together.
 * Triangle: apex at the middle of the top edge, base along the bottom edge. Circle: inscribed in the frame.
 */
export function shapeDistance(shape: FaceShape, fx: number, fy: number): number {
  if (shape === 'circle') return Math.hypot(fx - 0.5, fy - 0.5) - 0.5;
  if (shape === 'triangle') {
    const left = (-(fx - 0.5) - 0.5 * fy) * INV_EDGE;
    const right = ((fx - 0.5) - 0.5 * fy) * INV_EDGE;
    return Math.max(left, right, fy - 1);
  }
  return -1;
}
