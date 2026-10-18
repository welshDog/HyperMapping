import { describe, it, expect } from 'vitest';
import { SurfaceSync } from './surface-sync';
import { unitToNdc } from '../warp/mesh';
import { FULL_RECT, type FaceShape, type Surface } from '../surfaces/types';
import type { Corners } from '../warp/types';

const quad: Corners = { tl: [0.2, 0.2], tr: [0.8, 0.25], br: [0.75, 0.8], bl: [0.15, 0.7] };
const quad2: Corners = { tl: [0.1, 0.1], tr: [0.9, 0.1], br: [0.9, 0.9], bl: [0.1, 0.9] };
const bow: Corners = { tl: [0, 0], tr: [1, 0], br: [0, 1], bl: [1, 1] };
const face = (id: string, corners: Corners = quad, srcRect = FULL_RECT, shape?: FaceShape): Surface =>
  shape ? { id, corners, srcRect, shape } : { id, corners, srcRect };
const V = (a: Float32Array, i: number) => [a[2 * i], a[2 * i + 1]];

describe('SurfaceSync', () => {
  it('creates buffers for new faces and reports them as changed', () => {
    const sync = new SurfaceSync();
    const r = sync.sync([face('a'), face('b', quad2)]);
    expect(r.created).toEqual(['a', 'b']);
    expect(r.changedPositions).toEqual(['a', 'b']);
    expect(r.changedUvs).toEqual(['a', 'b']);
    expect(r.removed).toEqual([]);
    expect(r.order).toEqual(['a', 'b']);
    const a = sync.buffers('a')!;
    expect(a.positions.length).toBe(882);
    expect(a.uvs.length).toBe(882);
    const [x, y] = unitToNdc(quad.tl);
    expect(V(a.positions, 0)[0]).toBeCloseTo(x, 6);
    expect(V(a.positions, 0)[1]).toBeCloseTo(y, 6);
  });

  it('reports nothing when the same list is synced again', () => {
    const sync = new SurfaceSync();
    sync.sync([face('a')]);
    const r = sync.sync([face('a')]);
    expect(r).toEqual({ removed: [], created: [], changedPositions: [], changedUvs: [], changedFrames: [], order: ['a'] });
  });

  it('a corner change updates only positions', () => {
    const sync = new SurfaceSync();
    sync.sync([face('a')]);
    const r = sync.sync([face('a', quad2)]);
    expect(r.changedPositions).toEqual(['a']);
    expect(r.changedUvs).toEqual([]);
    const [x, y] = unitToNdc(quad2.tl);
    expect(V(sync.buffers('a')!.positions, 0)[0]).toBeCloseTo(x, 6);
    expect(V(sync.buffers('a')!.positions, 0)[1]).toBeCloseTo(y, 6);
  });

  it('a slice change updates only UVs, scaled into the slice', () => {
    const sync = new SurfaceSync();
    sync.sync([face('a')]);
    const r = sync.sync([face('a', quad, { u0: 0.25, v0: 0.1, u1: 0.75, v1: 0.9 })]);
    expect(r.changedUvs).toEqual(['a']);
    expect(r.changedPositions).toEqual([]);
    const uv = sync.buffers('a')!.uvs;
    expect(V(uv, 0)[0]).toBeCloseTo(0.25, 5);
    expect(V(uv, 0)[1]).toBeCloseTo(0.1, 5);
    expect(V(uv, 440)[0]).toBeCloseTo(0.75, 5);
    expect(V(uv, 440)[1]).toBeCloseTo(0.9, 5);
  });

  it('a bad quad freezes only that face; others still update', () => {
    const sync = new SurfaceSync();
    sync.sync([face('a'), face('b')]);
    const before = Array.from(sync.buffers('a')!.positions);
    const r = sync.sync([face('a', bow), face('b', quad2)]);
    expect(r.changedPositions).toEqual(['b']);
    expect(Array.from(sync.buffers('a')!.positions)).toEqual(before);
    expect(sync.buffers('a')!.positions.every(Number.isFinite)).toBe(true);
  });

  it('a bad slice keeps the previous UVs', () => {
    const sync = new SurfaceSync();
    sync.sync([face('a', quad, { u0: 0.25, v0: 0.1, u1: 0.75, v1: 0.9 })]);
    const before = Array.from(sync.buffers('a')!.uvs);
    const r = sync.sync([face('a', quad, { u0: 0.8, v0: 0.1, u1: 0.2, v1: 0.9 })]);
    expect(r.changedUvs).toEqual([]);
    expect(Array.from(sync.buffers('a')!.uvs)).toEqual(before);
  });

  it('a new face with an invalid quad starts as the full-canvas quad', () => {
    const sync = new SurfaceSync();
    sync.sync([face('a', bow)]);
    const p = sync.buffers('a')!.positions;
    expect(V(p, 0)).toEqual([-1, 1]);
    expect(V(p, 440)).toEqual([1, -1]);
  });

  it('a new face with an invalid slice starts with the full video', () => {
    const sync = new SurfaceSync();
    sync.sync([face('a', quad, { u0: 0.9, v0: 0, u1: 0.1, v1: 1 })]);
    const uv = sync.buffers('a')!.uvs;
    expect(V(uv, 0)).toEqual([0, 0]);
    expect(V(uv, 440)).toEqual([1, 1]);
  });

  it('reports removed faces, forgets their buffers, and keeps list order', () => {
    const sync = new SurfaceSync();
    sync.sync([face('a'), face('b'), face('c')]);
    const r = sync.sync([face('c'), face('a')]);
    expect(r.removed).toEqual(['b']);
    expect(sync.buffers('b')).toBeUndefined();
    expect(r.order).toEqual(['c', 'a']);
    expect(r.created).toEqual([]);
  });

  it('churn does not accumulate state', () => {
    const sync = new SurfaceSync();
    for (let i = 0; i < 50; i++) {
      sync.sync([face('a'), face('tmp' + i)]);
      sync.sync([face('a')]);
    }
    expect(sync.buffers('tmp49')).toBeUndefined();
    expect(sync.sync([face('a')]).removed).toEqual([]);
  });

  it('an empty list removes everything', () => {
    const sync = new SurfaceSync();
    sync.sync([face('a')]);
    const r = sync.sync([]);
    expect(r.removed).toEqual(['a']);
    expect(r.order).toEqual([]);
  });
});

describe('SurfaceSync shapes', () => {
  it('a new circle face reports all three buffers and carries margin frame coordinates', () => {
    const sync = new SurfaceSync();
    const r = sync.sync([face('c', quad, FULL_RECT, 'circle')]);
    expect(r.created).toEqual(['c']);
    expect(r.changedPositions).toEqual(['c']);
    expect(r.changedUvs).toEqual(['c']);
    expect(r.changedFrames).toEqual(['c']);
    const f = sync.buffers('c')!.frame;
    expect(f.length).toBe(441 * 3);
    expect(f[0]).toBeCloseTo(-0.02, 6);
    expect(f[1]).toBeCloseTo(-0.02, 6);
    expect(f[2]).toBe(2);
  });
  it('a new quad face has the plain frame grid and shape id 0', () => {
    const sync = new SurfaceSync();
    const r = sync.sync([face('q')]);
    expect(r.changedFrames).toEqual(['q']);
    expect(Array.from(sync.buffers('q')!.frame.slice(0, 3))).toEqual([0, 0, 0]);
  });
  it('a quad face keeps exactly the old positions (margin 0)', () => {
    const plain = new SurfaceSync();
    plain.sync([face('q')]);
    const shaped = new SurfaceSync();
    shaped.sync([face('q', quad, FULL_RECT, 'circle')]);
    expect(Array.from(shaped.buffers('q')!.positions)).not.toEqual(Array.from(plain.buffers('q')!.positions));
    const [x, y] = unitToNdc(quad.tl);
    expect(V(plain.buffers('q')!.positions, 0)[0]).toBeCloseTo(x, 6);
    expect(V(plain.buffers('q')!.positions, 0)[1]).toBeCloseTo(y, 6);
  });
  it('changing only the shape re-uploads positions, uvs and frame', () => {
    const sync = new SurfaceSync();
    sync.sync([face('a')]);
    const before = Array.from(sync.buffers('a')!.positions);
    const r = sync.sync([face('a', quad, FULL_RECT, 'circle')]);
    expect(r.created).toEqual([]);
    expect(r.changedPositions).toEqual(['a']);
    expect(r.changedUvs).toEqual(['a']);
    expect(r.changedFrames).toEqual(['a']);
    expect(Array.from(sync.buffers('a')!.positions)).not.toEqual(before);
    expect(sync.buffers('a')!.frame[2]).toBe(2);
  });
  it('a shaped face scales its margin UVs into the slice', () => {
    const sync = new SurfaceSync();
    sync.sync([face('a', quad, { u0: 0.25, v0: 0, u1: 0.75, v1: 1 }, 'triangle')]);
    const uv = sync.buffers('a')!.uvs;
    expect(uv[0]).toBeCloseTo(0.25 - 0.02 * 0.5, 6);
    expect(uv[1]).toBeCloseTo(-0.02, 6);
  });
  it('re-syncing an unchanged shaped face reports nothing', () => {
    const sync = new SurfaceSync();
    sync.sync([face('a', quad, FULL_RECT, 'circle')]);
    const r = sync.sync([face('a', quad, FULL_RECT, 'circle')]);
    expect(r.changedPositions).toEqual([]);
    expect(r.changedUvs).toEqual([]);
    expect(r.changedFrames).toEqual([]);
  });
  it('a non-convex frame on an existing shaped face keeps its previous positions', () => {
    const sync = new SurfaceSync();
    sync.sync([face('a', quad, FULL_RECT, 'circle')]);
    const before = Array.from(sync.buffers('a')!.positions);
    const r = sync.sync([face('a', bow, FULL_RECT, 'circle')]);
    expect(r.changedPositions).toEqual([]);
    expect(Array.from(sync.buffers('a')!.positions)).toEqual(before);
  });
  it('a brand-new shaped face with a non-convex frame falls back to the full canvas, no NaN', () => {
    const sync = new SurfaceSync();
    sync.sync([face('a', bow, FULL_RECT, 'triangle')]);
    const b = sync.buffers('a')!;
    expect(Array.from(b.positions).every(Number.isFinite)).toBe(true);
    expect(Array.from(b.frame).every(Number.isFinite)).toBe(true);
    expect(Array.from(b.uvs).every(Number.isFinite)).toBe(true);
  });
  it('a shape change on a face whose frame is invalid does not throw and leaves no NaN', () => {
    const sync = new SurfaceSync();
    sync.sync([face('a', bow)]);
    sync.sync([face('a', bow, FULL_RECT, 'circle')]);
    expect(Array.from(sync.buffers('a')!.positions).every(Number.isFinite)).toBe(true);
  });
});
