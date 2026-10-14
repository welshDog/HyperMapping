import type { Box } from './box';
import type { Projector } from './solve';

/** A 1 m cube on the floor, projector 3 m away, a little to the side and above it. */
export const DEFAULT_BOX: Box = { width: 1, height: 1, depth: 1, yawDeg: 0 };
export const DEFAULT_PROJECTOR: Projector = {
  distance: 3,
  azimuthDeg: 25,
  height: 1.5,
  throwRatio: 1.2,
  aspect: 16 / 9,
  shiftY: 0,
};
