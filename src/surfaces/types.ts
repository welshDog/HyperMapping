import type { Corners } from '../warp/types';

/** A rectangle of the video, in video space: 0..1, v down (v = 0 is the top row). */
export interface SrcRect {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

/** One mapped face: where it sits on the canvas, and which slice of the video it shows. */
export interface Surface {
  id: string;
  corners: Corners;
  srcRect: SrcRect;
}

export const MAX_SURFACES = 6;
/** A slice is never smaller than this fraction of the video, in width or height. */
export const MIN_SLICE = 0.05;
export const FULL_RECT: SrcRect = { u0: 0, v0: 0, u1: 1, v1: 1 };
