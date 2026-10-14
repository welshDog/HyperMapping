import { describe, it, expect } from 'vitest';
import { computeHomography, applyHomography, applyHomographyChecked } from './homography';
import type { Vec2 } from './types';

const SQ: Vec2[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
const TRAP: Vec2[] = [[-0.5, 1], [0.5, 1], [1, -1], [-1, -1]];

describe('computeHomography', () => {
  it('maps each source corner exactly onto its destination corner', () => {
    const h = computeHomography(SQ, TRAP)!;
    expect(h).not.toBeNull();
    SQ.forEach((p, i) => {
      const q = applyHomography(h, p);
      expect(q[0]).toBeCloseTo(TRAP[i][0], 9);
      expect(q[1]).toBeCloseTo(TRAP[i][1], 9);
    });
  });

  it('is the identity when source and destination are the same quad', () => {
    const h = computeHomography(SQ, SQ)!;
    const q = applyHomography(h, [0.3, 0.7]);
    expect(q[0]).toBeCloseTo(0.3, 9);
    expect(q[1]).toBeCloseTo(0.7, 9);
  });

  it('keeps the diagonal straight (bilinear blending would bend it)', () => {
    const h = computeHomography(SQ, TRAP)!;
    const a = applyHomography(h, [0, 0]);
    const b = applyHomography(h, [0.5, 0.5]);
    const c = applyHomography(h, [1, 1]);
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    expect(Math.abs(cross)).toBeLessThan(1e-9);
  });

  it('returns null when the destination corners are collinear', () => {
    expect(computeHomography(SQ, [[0, 0], [1, 1], [2, 2], [3, 3]])).toBeNull();
  });

  it('returns null when a destination coordinate is NaN', () => {
    expect(computeHomography(SQ, [[0, 0], [NaN, 0], [1, 1], [0, 1]])).toBeNull();
  });

  it('returns null when a destination coordinate is Infinity', () => {
    expect(computeHomography(SQ, [[0, 0], [1, 0], [Infinity, 1], [0, 1]])).toBeNull();
  });
});

describe('applyHomographyChecked', () => {
  it('equals applyHomography on a valid homography', () => {
    const h = computeHomography(SQ, TRAP)!;
    for (const p of [[0, 0], [0.3, 0.7], [1, 1]] as Vec2[]) {
      expect(applyHomographyChecked(h, p)).toEqual(applyHomography(h, p));
    }
  });

  it('returns null when the denominator w is 0 at the query point', () => {
    const h = [1, 0, 0, 0, 1, 0, 1, 0, 0];
    expect(applyHomographyChecked(h, [0, 0])).toBeNull();
  });

  it('returns null when w is tiny (|w| < 1e-12)', () => {
    const h = [1, 0, 0, 0, 1, 0, 0, 0, 1e-13];
    expect(applyHomographyChecked(h, [1, 1])).toBeNull();
  });

  it('returns null when w or the result is non-finite', () => {
    expect(applyHomographyChecked([1, 0, 0, 0, 1, 0, 0, 0, NaN], [1, 1])).toBeNull();
    expect(applyHomographyChecked([1, 0, 0, 0, 1, 0, 0, 0, Infinity], [1, 1])).toBeNull();
    expect(applyHomographyChecked([Infinity, 0, 0, 0, 1, 0, 0, 0, 1], [1, 1])).toBeNull();
    expect(applyHomographyChecked([1, 0, 0, 0, 1, 0, 0, 0, 1], [NaN, 0])).toBeNull();
  });
});
