import { describe, it, expect } from 'vitest';
import { isValidQuad, clampCorner } from './quad';
import type { Corners } from './types';

const SQUARE: Corners = { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] };

describe('isValidQuad', () => {
  it('accepts a convex quad', () => {
    expect(isValidQuad(SQUARE)).toBe(true);
    expect(isValidQuad({ tl: [0.2, 0.1], tr: [0.9, 0.2], br: [0.8, 0.9], bl: [0.1, 0.7] })).toBe(true);
  });
  it('rejects a bow-tie (two corners swapped)', () => {
    expect(isValidQuad({ tl: [0, 0], tr: [1, 0], br: [0, 1], bl: [1, 1] })).toBe(false);
  });
  it('rejects a concave quad', () => {
    expect(isValidQuad({ tl: [0, 0], tr: [1, 0], br: [0.2, 0.2], bl: [0, 1] })).toBe(false);
  });
  it('rejects three collinear corners', () => {
    expect(isValidQuad({ tl: [0, 0], tr: [0.5, 0], br: [1, 0], bl: [0, 1] })).toBe(false);
  });
  it('rejects a sliver with almost no area', () => {
    expect(isValidQuad({ tl: [0, 0], tr: [1, 0], br: [1, 0.00005], bl: [0, 0.00005] })).toBe(false);
  });
  it('rejects NaN coordinates', () => {
    expect(isValidQuad({ ...SQUARE, tl: [NaN, 0] })).toBe(false);
  });
});

describe('clampCorner', () => {
  it('clamps a runaway drag into [-0.5, 1.5]', () => {
    expect(clampCorner([-2, 3])).toEqual([-0.5, 1.5]);
  });
  it('leaves in-range points alone', () => {
    expect(clampCorner([0.3, 0.4])).toEqual([0.3, 0.4]);
  });
  it('maps NaN components to 0.5 and still clamps the other axis', () => {
    expect(clampCorner([NaN, 0.2])).toEqual([0.5, 0.2]);
  });
  it('clamps +/-Infinity to max/min', () => {
    expect(clampCorner([Infinity, -Infinity])).toEqual([1.5, -0.5]);
  });
});
