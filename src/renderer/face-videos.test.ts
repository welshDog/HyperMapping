import { describe, expect, it } from 'vitest';
import { distinctVideos } from './face-videos';

describe('distinctVideos', () => {
  const a = { n: 'a' };
  const b = { n: 'b' };
  it('collapses duplicates in first-use order', () => {
    const m: Record<string, typeof a> = { f1: b, f2: a, f3: b, f4: a };
    expect(distinctVideos(['f1', 'f2', 'f3', 'f4'], (id) => m[id])).toEqual([b, a]);
    expect(distinctVideos(['f1', 'f3'], (id) => m[id])).toHaveLength(1);
  });
  it('skips nulls', () => {
    const m: Record<string, typeof a | null> = { f1: null, f2: a };
    expect(distinctVideos(['f1', 'f2', 'f9'], (id) => m[id] ?? null)).toEqual([a]);
  });
  it('gives [] for an empty order', () => {
    expect(distinctVideos([], () => a)).toEqual([]);
  });
});
