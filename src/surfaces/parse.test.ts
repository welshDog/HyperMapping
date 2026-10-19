import { describe, it, expect } from 'vitest';
import { parseSurfaceList } from './parse';
import { DEFAULT_LOOK_SETTINGS } from '../generator/settings';

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
    expect(out[0].corners).not.toBe(input[0].corners);
    expect(out[0].corners.tl).not.toBe(input[0].corners.tl);
    expect(out[0].corners.tl).toEqual(input[0].corners.tl);
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
  describe('shape', () => {
    it('loads a face with no shape as a quad (old setups)', () => {
      const out = parseSurfaceList([surface('s1')])!;
      expect('shape' in out[0]).toBe(false);
    });
    it('keeps triangle and circle', () => {
      const out = parseSurfaceList([surface('s1', { shape: 'triangle' }), surface('s2', { shape: 'circle' })])!;
      expect(out.map((f) => f.shape)).toEqual(['triangle', 'circle']);
    });
    it('writes no shape key for an explicit quad', () => {
      const out = parseSurfaceList([surface('s1', { shape: 'quad' })])!;
      expect('shape' in out[0]).toBe(false);
    });
    it('rejects the whole list for an unknown or non-string shape', () => {
      expect(parseSurfaceList([surface('s1'), surface('s2', { shape: 'hexagon' })])).toBeNull();
      expect(parseSurfaceList([surface('s1', { shape: 3 })])).toBeNull();
      expect(parseSurfaceList([surface('s1', { shape: null })])).toBeNull();
    });
  });

  describe('face sources', () => {
    const look = { look: { style: 'plasma', seed: 3 }, speed: 1, shuffleSec: 0, stylePick: 'auto' };
    it('an old list gains no source/look/lookOf keys', () => {
      for (const f of parseSurfaceList([surface('s1'), surface('s2')])!) {
        expect('source' in f).toBe(false);
        expect('look' in f).toBe(false);
        expect('lookOf' in f).toBe(false);
      }
    });
    it('writes no source key for video', () => {
      expect('source' in parseSurfaceList([surface('s1', { source: 'video' })])![0]).toBe(false);
    });
    it('rejects an unknown source', () => {
      expect(parseSurfaceList([surface('s1'), surface('s2', { source: 'hologram' })])).toBeNull();
    });
    it('accepts a valid look and drops its unknown keys', () => {
      const out = parseSurfaceList([surface('s1', { source: 'look', look: { ...look, evil: 1 } })])!;
      expect(out[0].source).toBe('look');
      expect(out[0].look).toEqual(look);
    });
    it('rejects a bad look or a bad lookOf type', () => {
      expect(parseSurfaceList([surface('s1', { source: 'look', look: { ...look, speed: 9 } })])).toBeNull();
      expect(parseSurfaceList([surface('s1', { source: 'look', look: 'x' })])).toBeNull();
      expect(parseSurfaceList([surface('s1', { source: 'look', lookOf: 5 })])).toBeNull();
      expect(parseSurfaceList([surface('s1', { source: 'look', lookOf: '' })])).toBeNull();
    });
    it('keeps a good share and repairs a bad link instead of rejecting', () => {
      const ok = parseSurfaceList([surface('s1', { source: 'look', look }), surface('s2', { source: 'look', lookOf: 's1' })])!;
      expect(ok[1].lookOf).toBe('s1');
      const bad = parseSurfaceList([surface('s1', { source: 'look', lookOf: 'ghost' })])!;
      expect(bad[0].look).toEqual(DEFAULT_LOOK_SETTINGS);
      expect('lookOf' in bad[0]).toBe(false);
    });
    it('five owners from the wire come out as four owners and one Video face', () => {
      const out = parseSurfaceList([1, 2, 3, 4, 5].map((n) => surface('s' + n, { source: 'look', look })))!;
      expect(out.filter((f) => f.source === 'look')).toHaveLength(4);
      expect('source' in out[4] || 'look' in out[4]).toBe(false);
    });
  });
});
