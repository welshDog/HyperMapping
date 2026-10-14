import { describe, it, expect } from 'vitest';
import { parseSurfaceList } from './parse';

const corners = { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] };
const rect = { u0: 0, v0: 0, u1: 1, v1: 1 };
const surface = (id = 's1', over: Record<string, unknown> = {}) => ({ id, corners, srcRect: rect, ...over });

describe('parseSurfaceList', () => {
  it('accepts a valid list and returns fresh objects (not the input references)', () => {
    const input = [surface('s1'), surface('s2')];
    const out = parseSurfaceList(input)!;
    expect(out).toEqual(input);
    expect(out[0]).not.toBe(input[0]);
    expect(out[0].srcRect).not.toBe(input[0].srcRect);
  });
  it('drops unknown fields', () => {
    expect(parseSurfaceList([surface('s1', { evil: 1 })])).toEqual([surface('s1')]);
  });
  it('rejects non-arrays, empty lists and more than 6 faces', () => {
    expect(parseSurfaceList(undefined)).toBeNull();
    expect(parseSurfaceList('nope')).toBeNull();
    expect(parseSurfaceList({})).toBeNull();
    expect(parseSurfaceList([])).toBeNull();
    expect(parseSurfaceList(Array.from({ length: 7 }, (_, i) => surface('s' + (i + 1))))).toBeNull();
  });
  it('rejects bad entries, ids, corners and slices', () => {
    expect(parseSurfaceList([null])).toBeNull();
    expect(parseSurfaceList(['x'])).toBeNull();
    expect(parseSurfaceList([surface('a'), surface('a')])).toBeNull();
    expect(parseSurfaceList([surface('a', { id: 5 })])).toBeNull();
    expect(parseSurfaceList([surface('')])).toBeNull();
    expect(parseSurfaceList([surface('x'.repeat(33))])).toBeNull();
    expect(parseSurfaceList([surface('a', { corners: { ...corners, tl: [NaN, 0] } })])).toBeNull();
    expect(parseSurfaceList([surface('a', { corners: { tl: [0, 0] } })])).toBeNull();
    expect(parseSurfaceList([surface('a', { srcRect: { u0: 0.5, v0: 0, u1: 0.5, v1: 1 } })])).toBeNull();
    expect(parseSurfaceList([surface('a', { srcRect: { u0: '0', v0: 0, u1: 1, v1: 1 } })])).toBeNull();
  });
});
