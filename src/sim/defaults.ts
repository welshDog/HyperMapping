import type { Box } from './box';
import type { Projector } from './solve';

/** A 1 m cube on the floor, projector 3 m away, a little to the side and above it. */
export const DEFAULT_BOX: Box = { width: 1, height: 1, depth: 1, yawDeg: 0 };
export const DEFAULT_PROJECTOR: Projector = {
  distance: 3,
  azimuthDeg: 25,
  height: 1.5,
  throwRatio: 1.0,
  aspect: 16 / 9,
  shiftY: 0,
};

/** Projector image shapes offered in the simulator (a select, never a free number). */
export const ASPECT_PRESETS = [
  { label: '16:9', value: 16 / 9 },
  { label: '16:10', value: 16 / 10 },
  { label: '4:3', value: 4 / 3 },
  { label: '19.5:9', value: 19.5 / 9 },
  { label: '20:9', value: 20 / 9 },
] as const;
