import { describe, it, expect } from 'vitest';
import { computeBackingSize } from './fit';

describe('computeBackingSize', () => {
  it('multiplies css size by dpr (capped at 2) and scale', () => {
    expect(computeBackingSize(400, 800, 3, 1)).toEqual({ w: 800, h: 1600 });
    expect(computeBackingSize(400, 800, 3, 0.5)).toEqual({ w: 400, h: 800 });
    expect(computeBackingSize(1000, 500, 1, 0.5)).toEqual({ w: 500, h: 250 });
  });
  it('never returns zero or more than 4096', () => {
    expect(computeBackingSize(0, 0, 2, 1)).toEqual({ w: 1, h: 1 });
    expect(computeBackingSize(5000, 100, 2, 1)).toEqual({ w: 4096, h: 200 });
  });
  it('treats a bad dpr as 1', () => {
    expect(computeBackingSize(100, 100, 0, 1)).toEqual({ w: 100, h: 100 });
  });
});
