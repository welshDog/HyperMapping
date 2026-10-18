import { describe, expect, it } from 'vitest';
import { beatTargets, carryToHeirs, reconcileLooks, shuffleTargets, withLookSettings } from './looks';
import { removeSurface } from '../surfaces/model';
import { setFaceSource } from '../surfaces/sources';
import { randomizeState } from './shuffle';
import { mulberry32 } from './random';
import type { Surface } from '../surfaces/types';
import type { LookSettings } from './settings';

const ls = (seed: number): LookSettings => ({ look: { style: 'plasma', seed }, speed: 1, shuffleSec: 0, stylePick: 'auto' });
const corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] as unknown as Surface['corners'];
const face = (id: string, extra: Partial<Surface> = {}): Surface => ({
  id, corners, srcRect: { u0: 0, v0: 0, u1: 1, v1: 1 }, ...extra,
});
const list = (): Surface[] => [
  face('a', { source: 'look', look: ls(1) }),
  face('b', { source: 'look', look: ls(2) }),
  face('v', { source: 'video' }),
  face('s', { source: 'look', lookOf: 'a' }),
];

describe('reconcileLooks', () => {
  it('creates a state for each look-owning face only', () => {
    const out = reconcileLooks({}, list(), 1);
    expect(Object.keys(out).sort()).toEqual(['a', 'b']);
    expect(out.a.on).toBe(true);
    expect(out.a.look.seed).toBe(1);
  });
  it('returns the same object when nothing changed', () => {
    const first = reconcileLooks({}, list(), 1);
    expect(reconcileLooks(first, list(), 99)).toBe(first);
  });
  it('rebuilds only the owner whose settings changed', () => {
    const first = reconcileLooks({}, list(), 1);
    const l = list();
    l[0] = face('a', { source: 'look', look: ls(5) });
    const out = reconcileLooks(first, l, 2);
    expect(out).not.toBe(first);
    expect(out.a).not.toBe(first.a);
    expect(out.a.look.seed).toBe(5);
    expect(out.b).toBe(first.b);
  });
  it('drops owners that left the list', () => {
    const first = reconcileLooks({}, list(), 1);
    const out = reconcileLooks(first, list().filter((f) => f.id !== 'b'), 2);
    expect(Object.keys(out)).toEqual(['a']);
    expect(out.a).toBe(first.a);
  });
});

describe('withLookSettings', () => {
  it('writes a randomized look into only that owner', () => {
    const l = list();
    const states = reconcileLooks({}, l, 1);
    const next = randomizeState(states.a, 10, mulberry32(9));
    const out = withLookSettings(l, 'a', next);
    expect(out).not.toBe(l);
    expect(out[0].look?.look).toEqual(next.look);
    expect(out[1]).toBe(l[1]);
    expect(out[2]).toBe(l[2]);
  });
  it('returns the same list when nothing changed', () => {
    const l = list();
    const states = reconcileLooks({}, l, 1);
    expect(withLookSettings(l, 'a', states.a)).toBe(l);
  });
});

describe('reconcileLooks across whole-list replacements', () => {
  it('keeps an owner state identity when only another owner changes', () => {
    const first = reconcileLooks({}, list(), 1);
    const l = list();
    l[1] = face('b', { source: 'look', look: { ...ls(2), speed: 1.5 } });
    const out = reconcileLooks(first, l, 2);
    expect(out.a).toBe(first.a);
    expect(out.b).not.toBe(first.b);
    expect(out.b.speed).toBe(1.5);
  });
  it('a Setups-style load with the same ids rebuilds only the owner whose look differs', () => {
    const first = reconcileLooks({}, list(), 1);
    // A brand-new array of brand-new face objects, as a loaded setup gives.
    const loaded: Surface[] = [
      face('a', { source: 'look', look: ls(1) }),
      face('b', { source: 'look', look: { ...ls(2), shuffleSec: 30 } }),
      face('v', { source: 'video' }),
      face('s', { source: 'look', lookOf: 'a' }),
    ];
    const out = reconcileLooks(first, loaded, 50);
    expect(out.a).toBe(first.a);
    expect(out.b).not.toBe(first.b);
    expect(out.b.shuffleSec).toBe(30);
    expect(out.b.changedAt).toBe(50);
    expect(out.b.prev).toBeNull();
  });
  it('gives sharers, video and pattern faces no state, and an owner turned sharer loses its state', () => {
    const first = reconcileLooks({}, list(), 1);
    expect(Object.hasOwn(first, 's')).toBe(false);
    expect(Object.hasOwn(first, 'v')).toBe(false);
    const l = list();
    l[1] = face('b', { source: 'look', lookOf: 'a' });
    l.push(face('p', { source: 'pattern' }));
    const out = reconcileLooks(first, l, 2);
    expect(Object.keys(out)).toEqual(['a']);
    expect(out.a).toBe(first.a);
  });
});

describe('shuffleTargets', () => {
  const states = () => {
    const l = [
      face('a', { source: 'look', look: { ...ls(1), shuffleSec: 15 } }),
      face('b', { source: 'look', look: { ...ls(2), shuffleSec: 15 } }),
      face('c', { source: 'look', look: ls(3) }), // shuffle off
    ];
    return reconcileLooks({}, l, 0);
  };
  it('lists only visible looks whose shuffle is due', () => {
    const s = states();
    expect(shuffleTargets(s, new Set(['a', 'b', 'c']), 14_999)).toEqual([]);
    expect(shuffleTargets(s, new Set(['a', 'b', 'c']), 15_000)).toEqual(['a', 'b']);
    expect(shuffleTargets(s, new Set(['b']), 15_000)).toEqual(['b']);
    expect(shuffleTargets(s, new Set(), 60_000)).toEqual([]);
  });
  it('ignores visible ids that own no look', () => {
    expect(shuffleTargets(states(), new Set(['zz']), 99_000)).toEqual([]);
  });
});

describe('beatTargets', () => {
  it('lists visible looks past their own 6 s throttle', () => {
    const l = [face('a', { source: 'look', look: ls(1) }), face('b', { source: 'look', look: ls(2) })];
    const s = reconcileLooks({}, l, 0);
    const changedB = { ...s, b: { ...s.b, changedAt: 4000 } };
    expect(beatTargets(changedB, new Set(['a', 'b']), 5999)).toEqual([]);
    expect(beatTargets(changedB, new Set(['a', 'b']), 6000)).toEqual(['a']);
    expect(beatTargets(changedB, new Set(['a', 'b']), 10_000)).toEqual(['a', 'b']);
    expect(beatTargets(changedB, new Set(['b']), 10_000)).toEqual(['b']);
  });
});

describe('carryToHeirs', () => {
  it('a sharer promoted by deleting its owner keeps the owner state object (no restart)', () => {
    const l = list();
    const first = reconcileLooks({}, l, 1);
    const after = removeSurface(l, 'a'); // 's' becomes the owner of a's look
    const out = carryToHeirs(first, reconcileLooks(first, after, 500));
    expect(Object.keys(out).sort()).toEqual(['b', 's']);
    expect(out.s).toBe(first.a);
    expect(out.b).toBe(first.b);
  });
  it('switching a shared owner to Video hands its state to the heir', () => {
    const l = list();
    const first = reconcileLooks({}, l, 1);
    const after = setFaceSource(l, 'a', 'video', () => ls(9));
    const out = carryToHeirs(first, reconcileLooks(first, after, 500));
    expect(out.s).toBe(first.a);
  });
  it('a genuinely new look (different settings) is left fresh, and no change returns the same object', () => {
    const l = list();
    const first = reconcileLooks({}, l, 1);
    const swapped = l.filter((f) => f.id !== 'b').concat(face('n', { source: 'look', look: ls(7) }));
    const out = carryToHeirs(first, reconcileLooks(first, swapped, 500));
    expect(out.n.changedAt).toBe(500);
    expect(carryToHeirs(first, first)).toBe(first);
    const same = reconcileLooks(first, l, 2);
    expect(carryToHeirs(first, same)).toBe(same);
  });
});
