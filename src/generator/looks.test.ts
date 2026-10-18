import { describe, expect, it } from 'vitest';
import { reconcileLooks, withLookSettings } from './looks';
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
