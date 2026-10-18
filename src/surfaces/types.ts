import type { Corners } from '../warp/types';

/** A rectangle of the video, in video space: 0..1, v down (v = 0 is the top row). */
export interface SrcRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export type FaceShape = 'quad' | 'triangle' | 'circle';
export const FACE_SHAPES: readonly FaceShape[] = ['quad', 'triangle', 'circle'];

/**
 * One mapped face: where its four-pin frame sits on the canvas, and which slice of the video it shows.
 * `shape` is cut out of the frame; missing means a plain quad (so old setups still load).
 */
export interface Surface {
  id: string;
  corners: Corners;
  srcRect: SrcRect;
  shape?: FaceShape;
}

export const shapeOf = (s: Surface): FaceShape => s.shape ?? 'quad';

export const MAX_SURFACES = 6;
/** A slice is never smaller than this fraction of the video, in width or height. */
export const MIN_SLICE = 0.05;
export const FULL_RECT: SrcRect = { u0: 0, v0: 0, u1: 1, v1: 1 };
