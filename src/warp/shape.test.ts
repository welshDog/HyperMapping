import { describe, it, expect } from 'vitest';
import { SHAPE_MARGIN, meshMargin, shapeDistance, shapeId } from './shape';

describe('shapeDistance', () => {
  it('circle: centre is -0.5, the right edge is 0, a corner is outside', () => {
    expect(shapeDistance('circle', 0.5, 0.5)).toBeCloseTo(-0.5, 9);
    expect(shapeDistance('circle', 1, 0.5)).toBeCloseTo(0, 9);
    expect(shapeDistance('circle', 1, 1)).toBeGreaterThan(0);
  });
  it('triangle: apex and base middle are on the edge, the middle is inside', () => {
    expect(shapeDistance('triangle', 0.5, 0)).toBeCloseTo(0, 9);
    expect(shapeDistance('triangle', 0.5, 1)).toBeCloseTo(0, 9);
    expect(shapeDistance('triangle', 0.5, 0.5)).toBeLessThan(0);
  });
  it('triangle: the empty top corners and below the base are outside', () => {
    expect(shapeDistance('triangle', 0, 0)).toBeGreaterThan(0);
    expect(shapeDistance('triangle', 1, 0)).toBeGreaterThan(0);
    expect(shapeDistance('triangle', 0.5, 1.1)).toBeGreaterThan(0);
  });
  it('triangle: the base ends are on the edge', () => {
    expect(shapeDistance('triangle', 0, 1)).toBeCloseTo(0, 9);
    expect(shapeDistance('triangle', 1, 1)).toBeCloseTo(0, 9);
  });
  it('triangle: distance is a true distance in frame units (a point 0.1 below the base)', () => {
    expect(shapeDistance('triangle', 0.5, 1.1)).toBeCloseTo(0.1, 9);
  });
  it('quad is always inside', () => {
    expect(shapeDistance('quad', 9, 9)).toBe(-1);
  });
});

describe('shape ids and margin', () => {
  it('numbers the shapes for the shaders', () => {
    expect(shapeId('quad')).toBe(0);
    expect(shapeId('triangle')).toBe(1);
    expect(shapeId('circle')).toBe(2);
  });
  it('quads get no margin, shaped faces get SHAPE_MARGIN', () => {
    expect(SHAPE_MARGIN).toBe(0.02);
    expect(meshMargin('quad')).toBe(0);
    expect(meshMargin('circle')).toBe(SHAPE_MARGIN);
    expect(meshMargin('triangle')).toBe(SHAPE_MARGIN);
  });
});
