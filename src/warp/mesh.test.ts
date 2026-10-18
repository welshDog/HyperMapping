import { describe, it, expect } from 'vitest';
import { buildTopology, warpedPositions, unitToNdc, GRID, scaleUvs, frameCoords } from './mesh';
import { applyHomography, computeHomography } from './homography';
import { UNIT_CORNERS, cornersToArray } from './types';
import type { Corners } from './types';

const SQUARE: Corners = { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] };
const V = (buf: Float32Array, i: number) => [buf[2 * i], buf[2 * i + 1]];

describe('buildTopology', () => {
  it('builds a 23x23 vertex grid (inner 21x21 plus an outer ring) with 2904 indices', () => {
    const t = buildTopology();
    expect(GRID).toBe(20);
    expect(t.vertexCount).toBe(529);
    expect(t.uvs.length).toBe(1058);
    expect(t.indices.length).toBe(2904);
    expect(Math.max(...t.indices)).toBe(528);
  });
  it('maps corner vertices to the corners of UV space', () => {
    const t = buildTopology();
    expect(V(t.uvs, 0)).toEqual([0, 0]);
    expect(V(t.uvs, 44)).toEqual([1, 0]);
    expect(V(t.uvs, 484)).toEqual([0, 1]);
    expect(V(t.uvs, 504)).toEqual([1, 1]);
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
    expect(V(p, 44)).toEqual([1, 1]);
    expect(V(p, 484)).toEqual([-1, -1]);
    expect(V(p, 504)).toEqual([1, -1]);
    expect(V(p, 264)[0]).toBeCloseTo(0, 9);
    expect(V(p, 264)[1]).toBeCloseTo(0, 9);
  });

  it('puts the corner vertices exactly on the requested pins', () => {
    const c: Corners = { tl: [0.3, 0.1], tr: [0.9, 0.2], br: [0.8, 0.9], bl: [0.1, 0.7] };
    const p = warpedPositions(c)!;
    const expected = [c.tl, c.tr, c.bl, c.br].map(unitToNdc);
    [24, 44, 484, 504].forEach((vi, k) => {
      expect(V(p, vi)[0]).toBeCloseTo(expected[k][0], 6);
      expect(V(p, vi)[1]).toBeCloseTo(expected[k][1], 6);
    });
  });

  it('returns null and leaves the buffer untouched for a bow-tie', () => {
    const out = new Float32Array(1058).fill(7);
    const bow: Corners = { tl: [0, 0], tr: [1, 0], br: [0, 1], bl: [1, 1] };
    expect(warpedPositions(bow, GRID, GRID, out)).toBeNull();
    expect(out.every((v) => v === 7)).toBe(true);
  });

  it('writes into the provided buffer and returns it', () => {
    const out = new Float32Array(1058);
    expect(warpedPositions(SQUARE, GRID, GRID, out)).toBe(out);
  });
});

describe('scaleUvs', () => {
  it('maps the base 0..1 UVs into the slice', () => {
    const t = buildTopology();
    const out = scaleUvs(t.uvs, { u0: 0.25, v0: 0.1, u1: 0.75, v1: 0.9 });
    expect(out.length).toBe(1058);
    expect([out[0], out[1]].map((n) => +n.toFixed(5))).toEqual([0.25, 0.1]);
    expect([out[1008], out[1009]].map((n) => +n.toFixed(5))).toEqual([0.75, 0.9]);
    expect([out[88], out[89]].map((n) => +n.toFixed(5))).toEqual([0.75, 0.1]); // vertex 44 = inner top-right
  });
  it('the full rect leaves UVs unchanged', () => {
    const t = buildTopology();
    const out = scaleUvs(t.uvs, { u0: 0, v0: 0, u1: 1, v1: 1 });
    expect(Array.from(out)).toEqual(Array.from(t.uvs));
  });
  it('writes into a provided buffer and returns it', () => {
    const t = buildTopology();
    const buf = new Float32Array(1058);
    expect(scaleUvs(t.uvs, { u0: 0, v0: 0, u1: 0.5, v1: 1 }, buf)).toBe(buf);
  });
});

describe('margin mesh', () => {
  const SKEW: Corners = { tl: [0.1, 0.2], tr: [0.9, 0.1], br: [0.8, 0.9], bl: [0.2, 0.8] };
  it('margin 0 equals the default output exactly', () => {
    expect(Array.from(warpedPositions(SKEW, GRID, GRID, undefined, 0)!)).toEqual(Array.from(warpedPositions(SKEW)!));
  });
  it('a margin samples the frame from -m to 1+m through the same homography', () => {
    const m = 0.02;
    const out = warpedPositions(SKEW, GRID, GRID, undefined, m)!;
    expect(out.length).toBe(529 * 2);
    const h = computeHomography(cornersToArray(UNIT_CORNERS), cornersToArray(SKEW).map(unitToNdc))!;
    const [ex, ey] = applyHomography(h, [-m, -m]);
    expect(out[0]).toBeCloseTo(ex, 6);
    expect(out[1]).toBeCloseTo(ey, 6);
  });
  it('buildTopology with a margin spreads the UVs over -m..1+m and keeps the indices', () => {
    const t = buildTopology(GRID, GRID, 0.02);
    expect(V(t.uvs, 0)[0]).toBeCloseTo(-0.02, 6);
    expect(V(t.uvs, 0)[1]).toBeCloseTo(-0.02, 6);
    expect(V(t.uvs, 528)[0]).toBeCloseTo(1.02, 6);
    expect(t.indices).toEqual(buildTopology().indices);
  });
  it('frameCoords gives [fx, fy, shapeId] per vertex on the extended grid', () => {
    const f = frameCoords(GRID, GRID, 0.02, 'circle');
    expect(f.length).toBe(529 * 3);
    expect(f[0]).toBeCloseTo(-0.02, 6);
    expect(f[1]).toBeCloseTo(-0.02, 6);
    expect(f[2]).toBe(2);
    expect(f[528 * 3]).toBeCloseTo(1.02, 6);
    expect(f[528 * 3 + 1]).toBeCloseTo(1.02, 6);
    expect(f[528 * 3 + 2]).toBe(2);
  });
  it('frameCoords for a quad with no margin is the plain grid with shape id 0', () => {
    const f = frameCoords(GRID, GRID, 0, 'quad');
    expect(Array.from(f.slice(0, 3))).toEqual([0, 0, 0]);
    expect(Array.from(f.slice(44 * 3, 44 * 3 + 3))).toEqual([1, 0, 0]);
  });
});
