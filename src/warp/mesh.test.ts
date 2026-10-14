import { describe, it, expect } from 'vitest';
import { buildTopology, warpedPositions, unitToNdc, GRID } from './mesh';
import type { Corners } from './types';

const SQUARE: Corners = { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] };
const V = (buf: Float32Array, i: number) => [buf[2 * i], buf[2 * i + 1]];

describe('buildTopology', () => {
  it('builds a 21x21 vertex grid with 2400 indices', () => {
    const t = buildTopology();
    expect(GRID).toBe(20);
    expect(t.vertexCount).toBe(441);
    expect(t.uvs.length).toBe(882);
    expect(t.indices.length).toBe(2400);
    expect(Math.max(...t.indices)).toBe(440);
  });
  it('maps corner vertices to the corners of UV space', () => {
    const t = buildTopology();
    expect(V(t.uvs, 0)).toEqual([0, 0]);
    expect(V(t.uvs, 20)).toEqual([1, 0]);
    expect(V(t.uvs, 420)).toEqual([0, 1]);
    expect(V(t.uvs, 440)).toEqual([1, 1]);
  });
});

describe('unitToNdc', () => {
  it('flips Y and recentres', () => {
    expect(unitToNdc([0, 0])).toEqual([-1, 1]);
    expect(unitToNdc([1, 1])).toEqual([1, -1]);
    expect(unitToNdc([0.5, 0.5])).toEqual([0, 0]);
  });
});

describe('warpedPositions', () => {
  it('an unwarped square fills clip space', () => {
    const p = warpedPositions(SQUARE)!;
    expect(V(p, 0)).toEqual([-1, 1]);
    expect(V(p, 20)).toEqual([1, 1]);
    expect(V(p, 420)).toEqual([-1, -1]);
    expect(V(p, 440)).toEqual([1, -1]);
    expect(V(p, 220)[0]).toBeCloseTo(0, 9);
    expect(V(p, 220)[1]).toBeCloseTo(0, 9);
  });

  it('puts the corner vertices exactly on the requested pins', () => {
    const c: Corners = { tl: [0.3, 0.1], tr: [0.9, 0.2], br: [0.8, 0.9], bl: [0.1, 0.7] };
    const p = warpedPositions(c)!;
    const expected = [c.tl, c.tr, c.bl, c.br].map(unitToNdc);
    [0, 20, 420, 440].forEach((vi, k) => {
      expect(V(p, vi)[0]).toBeCloseTo(expected[k][0], 6);
      expect(V(p, vi)[1]).toBeCloseTo(expected[k][1], 6);
    });
  });

  it('returns null and leaves the buffer untouched for a bow-tie', () => {
    const out = new Float32Array(882).fill(7);
    const bow: Corners = { tl: [0, 0], tr: [1, 0], br: [0, 1], bl: [1, 1] };
    expect(warpedPositions(bow, GRID, GRID, out)).toBeNull();
    expect(out.every((v) => v === 7)).toBe(true);
  });

  it('writes into the provided buffer and returns it', () => {
    const out = new Float32Array(882);
    expect(warpedPositions(SQUARE, GRID, GRID, out)).toBe(out);
  });
});
