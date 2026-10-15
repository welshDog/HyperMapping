/** Above these the phone counts as moving: rotation in degrees per second, acceleration in m/s^2 (gravity removed). */
export const MOTION_LIMITS = { rotation: 20, accel: 1.2 };

export interface MotionSample {
  rotation: number;
  accel: number;
}

/** Length of a 3-vector; missing or non-finite parts count as zero. */
export function magnitude(a: number | null | undefined, b: number | null | undefined, c: number | null | undefined): number {
  const f = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return Math.sqrt(f(a) ** 2 + f(b) ** 2 + f(c) ** 2);
}

export function isMoving(s: MotionSample, limits = MOTION_LIMITS): boolean {
  return s.rotation > limits.rotation || s.accel > limits.accel;
}
