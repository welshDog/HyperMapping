import { describe, expect, it } from 'vitest';
import { mulberry32, randomSeed32 } from './random';

describe('mulberry32', () => {
  it('same seed gives same sequence', () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 100; i++) expect(a()).toBe(b());
  });
  it('values are in [0,1)', () => {
    const r = mulberry32(99);
    for (let i = 0; i < 5000; i++) {
      const v = r();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
  it('different seeds differ', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const sa = Array.from({ length: 8 }, () => a());
    const sb = Array.from({ length: 8 }, () => b());
    expect(sa).not.toEqual(sb);
  });
});

describe('randomSeed32', () => {
  it('is an integer in [0, 2^32)', () => {
    const r = mulberry32(7);
    for (let i = 0; i < 2000; i++) {
      const s = randomSeed32(r);
      expect(Number.isInteger(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(2 ** 32);
    }
  });
});
