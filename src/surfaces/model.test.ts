import { describe, it, expect } from 'vitest';
import {
  addSurface,
  defaultCorners,
  defaultSlices,
  isValidSrcRect,
  isValidSurfaces,
  moveRect,
  removeSurface,
  resizeRect,
  selectAfterRemove,
  setSurfaceShape,
  surfaceColor,
} from './model';
import { FULL_RECT, MAX_SURFACES, MIN_SLICE, shapeOf, type Surface } from './types';
import { DEFAULT_LOOK_SETTINGS } from '../generator/settings';
import { isValidQuad } from '../warp/quad';

const one = (): Surface[] => [{ id: 's1', corners: defaultCorners(0, 1), srcRect: FULL_RECT }];
const grow = (n: number): Surface[] => {
  let list = one();
  while (list.length < n) list = addSurface(list);
  return list;
};
const R = { u0: 0.2, v0: 0.2, u1: 0.6, v1: 0.6 };

describe('defaultSlices', () => {
  it('one slice is the full video', () => {
    expect(defaultSlices(1)).toEqual([FULL_RECT]);
  });
  it('splits into equal vertical strips that tile the video', () => {
    const s = defaultSlices(3);
    expect(s).toHaveLength(3);
    expect(s[0].u0).toBe(0);
    expect(s[2].u1).toBe(1);
    for (let i = 0; i < 2; i++) expect(s[i].u1).toBeCloseTo(s[i + 1].u0, 12);
    s.forEach((r) => {
      expect(r.v0).toBe(0);
      expect(r.v1).toBe(1);
      expect(r.u1 - r.u0).toBeCloseTo(1 / 3, 12);
    });
  });
  it('treats 0 as 1', () => {
    expect(defaultSlices(0)).toHaveLength(1);
  });
});

describe('defaultCorners', () => {
  it('a lone face is the big centred quad', () => {
    expect(defaultCorners(0, 1)).toEqual({ tl: [0.2, 0.2], tr: [0.8, 0.2], br: [0.8, 0.8], bl: [0.2, 0.8] });
  });
  it('every index/total combination is a valid quad inside the canvas', () => {
    for (let total = 1; total <= MAX_SURFACES; total++) {
      for (let i = 0; i < total; i++) {
        const c = defaultCorners(i, total);
        expect(isValidQuad(c)).toBe(true);
        [c.tl, c.tr, c.br, c.bl].forEach(([x, y]) => {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x).toBeLessThanOrEqual(1);
          expect(y).toBeGreaterThanOrEqual(0);
          expect(y).toBeLessThanOrEqual(1);
        });
      }
    }
  });
  it('faces in a multi-face layout do not start on top of each other', () => {
    const tls = [0, 1, 2, 3, 4, 5].map((i) => defaultCorners(i, 6).tl.join(','));
    expect(new Set(tls).size).toBe(6);
  });
});

describe('addSurface', () => {
  it('appends a face and re-balances automatic slices', () => {
    const two = addSurface(one());
    expect(two).toHaveLength(2);
    expect(two[0].srcRect.u1).toBeCloseTo(0.5, 12);
    expect(two[1].srcRect.u0).toBeCloseTo(0.5, 12);
    const three = addSurface(two);
    expect(three[0].srcRect.u1).toBeCloseTo(1 / 3, 12);
    expect(three[2].srcRect.u0).toBeCloseTo(2 / 3, 12);
  });
  it('keeps a slice the user customised', () => {
    const custom = { u0: 0.1, v0: 0.1, u1: 0.6, v1: 0.9 };
    const two = addSurface(one());
    const edited = [{ ...two[0], srcRect: custom }, two[1]];
    const three = addSurface(edited);
    expect(three[0].srcRect).toEqual(custom);
    expect(three[1].srcRect.u0).toBeCloseTo(1 / 3, 12); // still automatic, so re-balanced
  });
  it('is a no-op at the maximum', () => {
    const full = grow(MAX_SURFACES);
    expect(full).toHaveLength(MAX_SURFACES);
    expect(addSurface(full)).toBe(full);
  });
  it('keeps ids unique after delete-then-add', () => {
    const three = grow(3);
    const without = removeSurface(three, three[1].id);
    const again = addSurface(without);
    expect(new Set(again.map((s) => s.id)).size).toBe(3);
  });
});

describe('removeSurface', () => {
  it('removes by id and keeps order', () => {
    const three = grow(3);
    const out = removeSurface(three, three[1].id);
    expect(out.map((s) => s.id)).toEqual([three[0].id, three[2].id]);
  });
  it('refuses to remove the last face', () => {
    const l = one();
    expect(removeSurface(l, 's1')).toBe(l);
  });
  it('ignores an unknown id', () => {
    const l = grow(2);
    expect(removeSurface(l, 'nope')).toBe(l);
  });
});

describe('selectAfterRemove', () => {
  it('prefers the previous neighbour, else the next', () => {
    const l = grow(3);
    expect(selectAfterRemove(l, l[1].id)).toBe(l[0].id);
    expect(selectAfterRemove(l, l[2].id)).toBe(l[1].id);
    expect(selectAfterRemove(l, l[0].id)).toBe(l[1].id);
  });
});

describe('isValidSrcRect', () => {
  it('accepts the full rect and a normal slice', () => {
    expect(isValidSrcRect(FULL_RECT)).toBe(true);
    expect(isValidSrcRect(R)).toBe(true);
  });
  it('rejects tiny, inverted, out-of-range and non-finite rects', () => {
    expect(isValidSrcRect({ u0: 0.2, v0: 0, u1: 0.2 + MIN_SLICE / 2, v1: 1 })).toBe(false);
    expect(isValidSrcRect({ u0: 0.6, v0: 0, u1: 0.2, v1: 1 })).toBe(false);
    expect(isValidSrcRect({ u0: -0.1, v0: 0, u1: 0.5, v1: 1 })).toBe(false);
    expect(isValidSrcRect({ u0: 0, v0: 0, u1: 1.1, v1: 1 })).toBe(false);
    expect(isValidSrcRect({ u0: NaN, v0: 0, u1: 1, v1: 1 })).toBe(false);
  });
});

describe('moveRect', () => {
  it('moves without changing size', () => {
    const m = moveRect(R, 0.1, 0.05);
    expect(m.u0).toBeCloseTo(0.3, 12);
    expect(m.u1 - m.u0).toBeCloseTo(0.4, 12);
    expect(isValidSrcRect(m)).toBe(true);
  });
  it('clamps at the edges and keeps the size', () => {
    const br = moveRect(R, 5, 5);
    expect(br.u1).toBeCloseTo(1, 12);
    expect(br.v1).toBeCloseTo(1, 12);
    expect(br.u1 - br.u0).toBeCloseTo(0.4, 12);
    const tl = moveRect(R, -5, -5);
    expect(tl.u0).toBeCloseTo(0, 12);
    expect(tl.v0).toBeCloseTo(0, 12);
    expect(isValidSrcRect(br) && isValidSrcRect(tl)).toBe(true);
  });
  it('treats NaN deltas as zero', () => {
    const m = moveRect(R, NaN, NaN);
    (['u0', 'v0', 'u1', 'v1'] as const).forEach((k) => expect(m[k]).toBeCloseTo(R[k], 12));
  });
});

describe('resizeRect', () => {
  it('drags the named corner and leaves the opposite corner alone', () => {
    const r = resizeRect(R, 'br', 0.8, 0.9);
    expect(r).toEqual({ u0: 0.2, v0: 0.2, u1: 0.8, v1: 0.9 });
  });
  it('clamps to the video bounds', () => {
    const r = resizeRect(R, 'tl', -5, -5);
    expect(r.u0).toBe(0);
    expect(r.v0).toBe(0);
    const r2 = resizeRect(R, 'br', 9, 9);
    expect(r2.u1).toBe(1);
    expect(r2.v1).toBe(1);
  });
  it('never collapses below MIN_SLICE or crosses the opposite corner', () => {
    const r = resizeRect(R, 'tl', 0.9, 0.9);
    expect(r.u0).toBeCloseTo(R.u1 - MIN_SLICE, 12);
    expect(r.v0).toBeCloseTo(R.v1 - MIN_SLICE, 12);
    expect(isValidSrcRect(r)).toBe(true);
    const r2 = resizeRect(R, 'br', 0, 0);
    expect(r2.u1).toBeCloseTo(R.u0 + MIN_SLICE, 12);
    expect(isValidSrcRect(r2)).toBe(true);
  });
  it('ignores non-finite pointer values', () => {
    expect(resizeRect(R, 'tr', NaN, Infinity).u1).toBeLessThanOrEqual(1);
    expect(isValidSrcRect(resizeRect(R, 'tr', NaN, NaN))).toBe(true);
    expect(resizeRect(R, 'tr', NaN, NaN)).toEqual(R);
  });
});

describe('isValidSurfaces', () => {
  it('accepts 1..6 well-formed faces', () => {
    expect(isValidSurfaces(one())).toBe(true);
    expect(isValidSurfaces(grow(6))).toBe(true);
  });
  it('rejects empty, too many, duplicate or bad ids', () => {
    expect(isValidSurfaces([])).toBe(false);
    expect(isValidSurfaces([...grow(6), { ...one()[0], id: 'extra' }])).toBe(false);
    const l = grow(2);
    expect(isValidSurfaces([l[0], { ...l[1], id: l[0].id }])).toBe(false);
    expect(isValidSurfaces([{ ...one()[0], id: '' }])).toBe(false);
    expect(isValidSurfaces([{ ...one()[0], id: 'x'.repeat(33) }])).toBe(false);
  });
  it('rejects a bad slice or non-finite corners', () => {
    expect(isValidSurfaces([{ ...one()[0], srcRect: { u0: 0.5, v0: 0, u1: 0.5, v1: 1 } }])).toBe(false);
    const c = defaultCorners(0, 1);
    expect(isValidSurfaces([{ ...one()[0], corners: { ...c, tl: [NaN, 0] } }])).toBe(false);
  });
});

describe('surfaceColor', () => {
  it('has six distinct colours and wraps', () => {
    const colors = [0, 1, 2, 3, 4, 5].map(surfaceColor);
    expect(new Set(colors).size).toBe(6);
    expect(surfaceColor(6)).toBe(colors[0]);
  });
});

describe('face shapes', () => {
  it('addSurface with a shape appends that shape with the quad defaults', () => {
    const base = one();
    const withCircle = addSurface(base, 'circle');
    const withQuad = addSurface(base);
    expect(withCircle[1].shape).toBe('circle');
    expect(withCircle[1].corners).toEqual(withQuad[1].corners);
    expect(withCircle[1].srcRect).toEqual(withQuad[1].srcRect);
  });
  it('addSurface without a shape leaves no shape key', () => {
    expect('shape' in addSurface(one())[1]).toBe(false);
  });
  it('setSurfaceShape changes only the shape', () => {
    const list = grow(2);
    const out = setSurfaceShape(list, 's2', 'triangle');
    expect(out[1].shape).toBe('triangle');
    expect(out[1].id).toBe('s2');
    expect(out[1].corners).toEqual(list[1].corners);
    expect(out[1].srcRect).toEqual(list[1].srcRect);
    expect(out[0]).toBe(list[0]);
  });
  it('setSurfaceShape returns the same list for an unknown id or an unchanged shape', () => {
    const list = grow(2);
    expect(setSurfaceShape(list, 'nope', 'circle')).toBe(list);
    expect(setSurfaceShape(list, 's1', 'quad')).toBe(list);
  });
  it('shapeOf defaults to quad', () => {
    expect(shapeOf(one()[0])).toBe('quad');
    expect(shapeOf({ ...one()[0], shape: 'circle' })).toBe('circle');
  });
  it('isValidSurfaces rejects an unknown shape value', () => {
    const bad = [{ ...one()[0], shape: 'hexagon' as never }];
    expect(isValidSurfaces(bad)).toBe(false);
  });
});

describe('removeSurface with looks', () => {
  const f = (id: string, over: Partial<Surface> = {}): Surface => ({ id, corners: defaultCorners(0, 1), srcRect: FULL_RECT, ...over });
  const lookA = { ...DEFAULT_LOOK_SETTINGS, speed: 1.5 };
  it('promotes the first sharer of a removed owner and re-points the rest', () => {
    const list = [f('s1', { source: 'look', look: lookA }), f('s2', { source: 'look', lookOf: 's1' }), f('s3', { source: 'look', lookOf: 's1' })];
    expect(removeSurface(list, 's1')).toEqual([f('s2', { source: 'look', look: lookA }), f('s3', { source: 'look', lookOf: 's2' })]);
  });
  it('removing a sharer or a Video face leaves the rest identical', () => {
    const list = [f('s1', { source: 'look', look: lookA }), f('s2', { source: 'look', lookOf: 's1' }), f('s3')];
    const a = removeSurface(list, 's2');
    expect(a[0]).toBe(list[0]);
    expect(a[1]).toBe(list[2]);
    const b = removeSurface(list, 's3');
    expect(b[0]).toBe(list[0]);
    expect(b[1]).toBe(list[1]);
  });
  it('isValidSurfaces rejects an unknown source', () => {
    expect(isValidSurfaces([f('s1', { source: 'hologram' as never })])).toBe(false);
  });
});
