import { describe, expect, it } from 'vitest';
import { clampSpeed, setSpeed, shaderTime, SPEED_MAX, SPEED_MIN } from './speed';
import { initialState, isValidState } from './shuffle';

const base = () => initialState(1000, () => 0.3);

describe('clampSpeed', () => {
  it('clamps and defaults', () => {
    expect(SPEED_MIN).toBe(0.25);
    expect(SPEED_MAX).toBe(2);
    expect(clampSpeed(1)).toBe(1);
    expect(clampSpeed(0.1)).toBe(0.25);
    expect(clampSpeed(9)).toBe(2);
    expect(clampSpeed(NaN)).toBe(1);
    expect(clampSpeed(Infinity)).toBe(2);
    expect(clampSpeed(-3)).toBe(0.25);
  });
});

describe('shaderTime', () => {
  it('defaults equal elapsed seconds since startedAt', () => {
    const s = base();
    for (const now of [1000, 1500, 61000, 123456]) {
      expect(shaderTime(s, now)).toBeCloseTo((now - s.startedAt) / 1000, 9);
    }
  });
  it('before the change instant gives the anchor', () => {
    expect(shaderTime({ timeAnchor: 7, speedChangedAt: 5000, speed: 2 }, 4000)).toBe(7);
  });
  it('speed 2 doubles the elapsed part', () => {
    expect(shaderTime({ timeAnchor: 3, speedChangedAt: 1000, speed: 2 }, 4000)).toBeCloseTo(3 + 6, 9);
  });
});

describe('setSpeed', () => {
  it('is continuous at the change instant and advances at the new speed', () => {
    // the prior speed (0.3) is not in the tested list, so every iteration really changes speed
    for (const before of [0.3, 1.3]) {
    for (const sp of [0.25, 0.5, 1, 1.7, 2]) {
      for (const t of [0, 1234, 60000]) {
        const prev = { ...base(), speed: before, timeAnchor: 2, speedChangedAt: 0 };
        const next = setSpeed(prev, sp, t);
        expect(Math.abs(shaderTime(next, t) - shaderTime(prev, t))).toBeLessThan(1e-9);
        expect(shaderTime(next, t + 2000) - shaderTime(next, t)).toBeCloseTo(2 * next.speed, 9);
        expect(isValidState(next)).toBe(true);
      }
    }
    }
  });
  it('stays continuous over two successive changes', () => {
    const a = base();
    const b = setSpeed(a, 2, 5000);
    const c = setSpeed(b, 0.5, 9000);
    expect(shaderTime(b, 5000)).toBeCloseTo(shaderTime(a, 5000), 9);
    expect(shaderTime(c, 9000)).toBeCloseTo(shaderTime(b, 9000), 9);
    expect(shaderTime(c, 11000)).toBeCloseTo(shaderTime(b, 9000) + 1, 9);
  });
  it('clamps out-of-range input', () => {
    expect(setSpeed(base(), 9, 2000).speed).toBe(2);
    expect(setSpeed(base(), 0, 2000).speed).toBe(0.25);
  });
  it('returns the same object for the same speed', () => {
    const s = base();
    expect(setSpeed(s, 1, 2000)).toBe(s);
  });
});
