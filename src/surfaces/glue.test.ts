import { describe, it, expect } from 'vitest';
import { DEFAULT_BOX, DEFAULT_PROJECTOR } from '../sim/defaults';
import { solveFaces, toSurfaces } from '../sim/solve';
import type { Corners } from '../warp/types';
import { CORNER_KEYS, GLUE_EPS, SNAP_RADIUS_PX, gluedGroup, moveGluedPin, movePins, snapTarget, type PinRef } from './glue';
import { FULL_RECT, type Surface } from './types';

const sq = (x0: number, y0: number, x1: number, y1: number): Corners => ({
  tl: [x0, y0],
  tr: [x1, y0],
  br: [x1, y1],
  bl: [x0, y1],
});
const face = (id: string, corners: Corners): Surface => ({ id, corners, srcRect: FULL_RECT });
const pin = (surfaceId: string, corner: PinRef['corner']): PinRef => ({ surfaceId, corner });
const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x));

// A and B sit side by side and share the edge x = 0.5 (A.tr == B.tl, A.br == B.bl).
const A = face('a', sq(0.1, 0.2, 0.5, 0.8));
const B = face('b', sq(0.5, 0.2, 0.9, 0.8));
// C is far away from both; its top-left is (0.6, 0.0).
const C = face('c', sq(0.6, 0.0, 0.95, 0.15));
const SIZE = { w: 1000, h: 500 };

describe('constants', () => {
  it('have the agreed values', () => {
    expect(GLUE_EPS).toBe(1e-6);
    expect(SNAP_RADIUS_PX).toBe(24);
    expect(CORNER_KEYS).toEqual(['tl', 'tr', 'br', 'bl']);
  });
});

describe('gluedGroup', () => {
  it('finds the pins on the same spot, in face then corner order, including itself', () => {
    expect(gluedGroup([A, B, C], pin('a', 'tr'))).toEqual([pin('a', 'tr'), pin('b', 'tl')]);
    expect(gluedGroup([A, B, C], pin('b', 'bl'))).toEqual([pin('a', 'br'), pin('b', 'bl')]);
  });
  it('a lone pin is a group of one; an unknown pin is empty', () => {
    expect(gluedGroup([A, B, C], pin('a', 'tl'))).toEqual([pin('a', 'tl')]);
    expect(gluedGroup([A, B, C], pin('nope', 'tl'))).toEqual([]);
  });
  it('is tolerant to 1e-7 but not to 1e-3', () => {
    const near = face('b', { ...B.corners, tl: [0.5 + 1e-7, 0.2] });
    const far = face('b', { ...B.corners, tl: [0.5 + 1e-3, 0.2] });
    expect(gluedGroup([A, near], pin('a', 'tr'))).toHaveLength(2);
    expect(gluedGroup([A, far], pin('a', 'tr'))).toHaveLength(1);
  });
});

describe('movePins', () => {
  it('moves every pin in the group to the same point and leaves other faces as the same objects', () => {
    const out = movePins([A, B, C], [pin('a', 'tr'), pin('b', 'tl')], [0.55, 0.25])!;
    expect(out[0].corners.tr).toEqual([0.55, 0.25]);
    expect(out[1].corners.tl).toEqual([0.55, 0.25]);
    expect(out[0].corners.tl).toEqual(A.corners.tl);
    expect(out[2]).toBe(C);
    expect(A.corners.tr).toEqual([0.5, 0.2]); // the input is not mutated
  });
  it('refuses the whole move when ANY affected face would become invalid, changing nothing', () => {
    const before = clone([A, B, C]);
    // x = 1.2 turns B inside out even though A alone would be fine
    expect(movePins([A, B, C], [pin('a', 'tr'), pin('b', 'tl')], [1.2, 0.2])).toBeNull();
    expect(movePins([A, B, C], [pin('a', 'tr')], [0.1, 0.9])).toBeNull(); // collinear A
    expect([A, B, C]).toEqual(before);
  });
  it('refuses non-finite targets, empty pin lists and unknown pins', () => {
    expect(movePins([A, B], [pin('a', 'tr')], [NaN, 0.2])).toBeNull();
    expect(movePins([A, B], [pin('a', 'tr')], [0.5, Infinity])).toBeNull();
    expect(movePins([A, B], [], [0.5, 0.5])).toBeNull();
    expect(movePins([A, B], [pin('zzz', 'tl')], [0.5, 0.5])).toBeNull();
  });
  it('refuses a group that holds two pins of the same face (it would collapse the face)', () => {
    expect(movePins([A, B], [pin('a', 'tl'), pin('a', 'tr')], [0.3, 0.5])).toBeNull();
  });
});

describe('snapTarget', () => {
  const lone = face('a', sq(0.1, 0.2, 0.4, 0.8)); // not touching C
  const c = face('c', sq(0.6, 0.2, 0.95, 0.5)); // c.tl = (0.6, 0.2)

  it('snaps to a pin of another face within the pixel radius and returns a copy', () => {
    const t = snapTarget([lone, c], pin('a', 'tr'), [0.59, 0.2], 24, SIZE)!; // 10 px away
    expect(t).toEqual([0.6, 0.2]);
    expect(t).not.toBe(c.corners.tl);
  });
  it('does not snap beyond the radius', () => {
    expect(snapTarget([lone, c], pin('a', 'tr'), [0.57, 0.2], 24, SIZE)).toBeNull(); // 30 px
  });
  it('measures the radius in pixels, so the canvas shape matters', () => {
    const p: [number, number] = [0.6, 0.23]; // dy = 0.03
    expect(snapTarget([lone, c], pin('a', 'tr'), p, 24, { w: 1000, h: 500 })).toEqual([0.6, 0.2]); // 15 px
    expect(snapTarget([lone, c], pin('a', 'tr'), p, 24, { w: 1000, h: 1000 })).toBeNull(); // 30 px
  });
  it('ignores the dragged pin\'s own face', () => {
    expect(snapTarget([lone, c], pin('a', 'tr'), [0.1, 0.2], 24, SIZE)).toBeNull(); // right on a.tl
  });
  it('ignores every face that already has a pin in the dragged group', () => {
    // dragging the shared pin of A and B: B's far corner b.tr (0.9, 0.2) must not be a target
    expect(snapTarget([A, B, C], pin('a', 'tr'), [0.9, 0.2], 24, SIZE)).toBeNull();
  });
  it('snaps at exactly the radius (d == radiusPx) and not just inside it', () => {
    // dyadic numbers so the pixel distance is exactly a 12-16-20 triangle in floating point
    const sz = { w: 1024, h: 1024 };
    const target = face('c', sq(0.5, 0.5, 0.95, 0.9));
    const p: [number, number] = [0.5 - 12 / 1024, 0.5 - 16 / 1024];
    expect(snapTarget([lone, target], pin('a', 'tr'), p, 20, sz)).toEqual([0.5, 0.5]);
    expect(snapTarget([lone, target], pin('a', 'tr'), p, 19.999, sz)).toBeNull();
  });
  it('picks the nearest of several candidates', () => {
    const d = face('d', sq(0.62, 0.2, 0.95, 0.5)); // d.tl = (0.62, 0.2)
    expect(snapTarget([lone, c, d], pin('a', 'tr'), [0.615, 0.2], 24, SIZE)).toEqual([0.62, 0.2]);
    expect(snapTarget([lone, c, d], pin('a', 'tr'), [0.605, 0.2], 24, SIZE)).toEqual([0.6, 0.2]);
  });
  it('returns null for bad input', () => {
    expect(snapTarget([lone, c], pin('a', 'tr'), [NaN, 0.2], 24, SIZE)).toBeNull();
    expect(snapTarget([lone, c], pin('a', 'tr'), [0.6, 0.2], 24, { w: 0, h: 500 })).toBeNull();
    expect(snapTarget([lone, c], pin('a', 'tr'), [0.6, 0.2], 0, SIZE)).toBeNull();
    expect(snapTarget([lone], pin('a', 'tr'), [0.6, 0.2], 24, SIZE)).toBeNull(); // nothing to snap to
  });
});

describe('moveGluedPin', () => {
  const opts = (glue: boolean) => ({ glue, radiusPx: 24, size: SIZE });

  it('Glue on: carries the whole glued group', () => {
    const out = moveGluedPin([A, B, C], pin('a', 'tr'), [0.55, 0.25], opts(true))!;
    expect(out[0].corners.tr).toEqual([0.55, 0.25]);
    expect(out[1].corners.tl).toEqual([0.55, 0.25]);
  });
  it('Glue off: only the dragged pin moves, and nothing snaps', () => {
    const out = moveGluedPin([A, B, C], pin('a', 'tr'), [0.55, 0.25], opts(false))!;
    expect(out[0].corners.tr).toEqual([0.55, 0.25]);
    expect(out[1].corners.tl).toEqual([0.5, 0.2]); // B stayed put: the glue is broken
    const noSnap = moveGluedPin([A, B, C], pin('a', 'tr'), [0.6, 0.01], opts(false))!; // right next to c.tl
    expect(noSnap[0].corners.tr).toEqual([0.6, 0.01]);
  });
  it('Glue on: snaps the whole group onto a nearby pin, after which all of them are glued', () => {
    const out = moveGluedPin([A, B, C], pin('a', 'tr'), [0.6, 0.02], opts(true))!; // 10 px from c.tl (0.6, 0.0)
    expect(out[0].corners.tr).toEqual([0.6, 0.0]);
    expect(out[1].corners.tl).toEqual([0.6, 0.0]);
    expect(out[2].corners.tl).toEqual([0.6, 0.0]);
    expect(gluedGroup(out, pin('a', 'tr'))).toEqual([pin('a', 'tr'), pin('b', 'tl'), pin('c', 'tl')]);
  });
  it('Glue on: a move that would break a partner face is refused and nothing changes', () => {
    const before = clone([A, B, C]);
    expect(moveGluedPin([A, B, C], pin('a', 'tr'), [1.2, 0.2], opts(true))).toBeNull();
    expect([A, B, C]).toEqual(before);
  });
  it('Glue on: if the snapped move is refused, the raw pointer position is tried once', () => {
    // D.br sits exactly on A.tl, so snapping A.tr onto D.br would put A.tr on A.tl and collapse A
    const D = face('d', sq(0.0, 0.0, 0.1, 0.2));
    const p: [number, number] = [0.11, 0.2]; // 10 px from D.br
    expect(snapTarget([A, D], pin('a', 'tr'), p, 24, SIZE)).toEqual([0.1, 0.2]);
    expect(movePins([A, D], [pin('a', 'tr')], [0.1, 0.2])).toBeNull();
    const out = moveGluedPin([A, D], pin('a', 'tr'), p, opts(true))!;
    expect(out).not.toBeNull();
    expect(out[0].corners.tr).toEqual(p);
    expect(out[0].corners.tr).not.toEqual(D.corners.br);
  });
  it('Glue on: with no snap target a refused move is not retried (still null)', () => {
    expect(moveGluedPin([A, B, C], pin('a', 'tr'), [1.2, 0.2], opts(true))).toBeNull();
  });
  it('computing every move of a drag from the drag-start list keeps the snap exact and never drags the target', () => {
    const base = [A, B, C];
    const o = opts(true);
    const near: [number, number] = [0.6, 0.02]; // 10 px from c.tl (0.6, 0.0)
    const far: [number, number] = [0.62, 0.1]; // 54 px from c.tl, all three faces stay valid
    const snapped = moveGluedPin(base, pin('a', 'tr'), near, o)!;
    for (const [id, c] of [['a', 'tr'], ['b', 'tl'], ['c', 'tl']] as const) {
      expect(snapped.find((s) => s.id === id)!.corners[c]).toEqual([0.6, 0.0]);
    }
    const away = moveGluedPin(base, pin('a', 'tr'), far, o)!;
    expect(away.find((s) => s.id === 'c')!.corners.tl).toEqual([0.6, 0.0]); // C is back where it was
    expect(away.find((s) => s.id === 'a')!.corners.tr).toEqual(far);
    expect(away.find((s) => s.id === 'b')!.corners.tl).toEqual(far);
    const again = moveGluedPin(base, pin('a', 'tr'), near, o)!;
    expect(again.find((s) => s.id === 'a')!.corners.tr).toEqual([0.6, 0.0]);
    // the bug the UI avoids: starting from the already-snapped RESULT, C.tl is glued and gets dragged along
    const bad = moveGluedPin(snapped, pin('a', 'tr'), far, o)!;
    expect(bad.find((s) => s.id === 'c')!.corners.tl).toEqual(far);
  });
  it('a single face with no partners moves just that pin, as before', () => {
    const out = moveGluedPin([A], pin('a', 'tr'), [0.45, 0.25], opts(true))!;
    expect(out[0].corners.tr).toEqual([0.45, 0.25]);
    expect(out[0].corners.tl).toEqual(A.corners.tl);
  });
  it('returns null for an unknown pin or a non-finite position', () => {
    expect(moveGluedPin([A, B], pin('zzz', 'tl'), [0.5, 0.5], opts(true))).toBeNull();
    expect(moveGluedPin([A, B], pin('a', 'tl'), [NaN, 0.5], opts(true))).toBeNull();
  });
});

describe('real Solve output', () => {
  const layout = toSurfaces(solveFaces(DEFAULT_BOX, DEFAULT_PROJECTOR));

  it('is glued at the shared box corners: one group of three, three groups of two', () => {
    expect(layout).toHaveLength(3);
    const seen = new Set<string>();
    const sizes: number[] = [];
    for (const s of layout) {
      for (const corner of CORNER_KEYS) {
        const key = `${s.id}:${corner}`;
        if (seen.has(key)) continue;
        const group = gluedGroup(layout, { surfaceId: s.id, corner });
        group.forEach((g) => seen.add(`${g.surfaceId}:${g.corner}`));
        sizes.push(group.length);
      }
    }
    expect(sizes.sort()).toEqual([1, 1, 1, 2, 2, 2, 3]);
  });

  it('moving the three-way corner carries all three faces', () => {
    const triple = layout
      .flatMap((s) => CORNER_KEYS.map((corner) => ({ surfaceId: s.id, corner })))
      .find((ref) => gluedGroup(layout, ref).length === 3)!;
    const at = layout.find((s) => s.id === triple.surfaceId)!.corners[triple.corner];
    const to: [number, number] = [at[0] + 0.01, at[1] + 0.01];
    const out = moveGluedPin(layout, triple, to, { glue: true, radiusPx: 0.0001, size: { w: 1000, h: 500 } })!;
    expect(out).not.toBeNull();
    for (const g of gluedGroup(layout, triple)) {
      expect(out.find((s) => s.id === g.surfaceId)!.corners[g.corner]).toEqual(to);
    }
  });
});
