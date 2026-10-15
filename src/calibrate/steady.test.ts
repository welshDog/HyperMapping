import { describe, it, expect } from 'vitest';
import { MOTION_LIMITS, isMoving, magnitude } from './steady';

describe('steadiness', () => {
  it('computes a vector length and treats missing values as zero', () => {
    expect(magnitude(3, 4, 0)).toBe(5);
    expect(magnitude(null, undefined, 2)).toBe(2);
    expect(magnitude(NaN, 0, 0)).toBe(0);
  });
  it('is steady below both limits and moving above either', () => {
    expect(isMoving({ rotation: 0, accel: 0 })).toBe(false);
    expect(isMoving({ rotation: MOTION_LIMITS.rotation, accel: MOTION_LIMITS.accel })).toBe(false);
    expect(isMoving({ rotation: MOTION_LIMITS.rotation + 1, accel: 0 })).toBe(true);
    expect(isMoving({ rotation: 0, accel: MOTION_LIMITS.accel + 0.1 })).toBe(true);
  });
});
