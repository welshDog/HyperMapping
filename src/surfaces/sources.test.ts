import { describe, it, expect } from 'vitest';
import { DEFAULT_LOOK_SETTINGS, type LookSettings } from '../generator/settings';
import { MAX_LOOKS, canStartLook, lookOwners, normalizeSources, ownerOf, setFaceSource, setOwnLook, shareLook } from './sources';
import { FULL_RECT, type Surface } from './types';

const corners = { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] } as Surface['corners'];
const face = (id: string, over: Partial<Surface> = {}): Surface => ({ id, corners, srcRect: FULL_RECT, ...over });
const lk = (seed: number): LookSettings => ({ ...DEFAULT_LOOK_SETTINGS, look: { ...DEFAULT_LOOK_SETTINGS.look, seed } });
const owner = (id: string, seed = 7): Surface => face(id, { source: 'look', look: lk(seed) });
const sharer = (id: string, of: string): Surface => face(id, { source: 'look', lookOf: of });
const make = () => lk(99);
const keys = (f: Surface) => Object.keys(f).sort();
const PLAIN = ['corners', 'id', 'srcRect'];

describe('normalizeSources', () => {
  it('keeps the first 4 owners and demotes the 5th to a plain Video face', () => {
    const out = normalizeSources([owner('s1'), owner('s2'), owner('s3'), owner('s4'), owner('s5')]);
    expect(lookOwners(out).map((f) => f.id)).toEqual(['s1', 's2', 's3', 's4']);
    expect(keys(out[4])).toEqual(PLAIN);
  });
  it('a sharer of a demoted owner can never push the count past the cap', () => {
    const out = normalizeSources([owner('s1'), owner('s2'), owner('s3'), owner('s4'), owner('s5'), sharer('s6', 's5')]);
    expect(lookOwners(out)).toHaveLength(MAX_LOOKS);
    expect(keys(out[5])).toEqual(PLAIN);
  });
  it('a sharer of a demoted owner becomes an own default look when a slot is free', () => {
    // s2 is a Video face with a stray look, so only 3 real owners + s5 = 4; s6 would be the 5th owner
    const out = normalizeSources([owner('s1'), face('s2', { look: lk(3) }), owner('s3'), owner('s4'), sharer('s5', 's2')]);
    expect(out[4].look).toEqual(DEFAULT_LOOK_SETTINGS);
    expect(out[4].lookOf).toBeUndefined();
    expect(lookOwners(out)).toHaveLength(4);
  });
  it('repairs a link to a missing id, itself or a Video face into an own default look', () => {
    for (const bad of ['zz', 's2', 's1']) {
      const out = normalizeSources([face('s1'), sharer('s2', bad)]);
      expect(out[1]).toEqual(face('s2', { source: 'look', look: DEFAULT_LOOK_SETTINGS }));
    }
  });
  it('a link to another sharer is repaired too', () => {
    const out = normalizeSources([owner('s1'), sharer('s2', 's1'), sharer('s3', 's2')]);
    expect(out[2].look).toEqual(DEFAULT_LOOK_SETTINGS);
    expect(out[1].lookOf).toBe('s1');
  });
  it('look wins over lookOf', () => {
    const out = normalizeSources([owner('s1'), face('s2', { source: 'look', look: lk(5), lookOf: 's1' })]);
    expect(out[1].look).toEqual(lk(5));
    expect(out[1].lookOf).toBeUndefined();
  });
  it('strips stray look fields from Video and Pattern faces and the Video source key', () => {
    const out = normalizeSources([
      face('s1', { look: lk(2), lookOf: 'x' }),
      face('s2', { source: 'video' }),
      face('s3', { source: 'pattern', look: lk(2) }),
    ]);
    expect(out[0]).toEqual(face('s1'));
    expect(keys(out[1])).toEqual(PLAIN);
    expect(out[2]).toEqual(face('s3', { source: 'pattern' }));
  });
  it('is idempotent and returns the same array for a valid list', () => {
    const valid = [owner('s1'), sharer('s2', 's1'), face('s3'), face('s4', { source: 'pattern' })];
    expect(normalizeSources(valid)).toBe(valid);
    const messy = [owner('s1'), owner('s2'), owner('s3'), owner('s4'), owner('s5'), sharer('s6', 's5')];
    const once = normalizeSources(messy);
    expect(normalizeSources(once)).toBe(once);
  });
});

describe('queries', () => {
  it('ownerOf finds the face itself, a valid target, or null', () => {
    const list = [owner('s1'), sharer('s2', 's1'), sharer('s3', 'nope'), face('s4')];
    expect(ownerOf(list, list[0])).toBe(list[0]);
    expect(ownerOf(list, list[1])).toBe(list[0]);
    expect(ownerOf(list, list[2])).toBeNull();
    expect(ownerOf(list, list[3])).toBeNull();
  });
});

describe('setFaceSource', () => {
  const four = [owner('s1', 1), owner('s2', 2), owner('s3', 3), owner('s4', 4), face('s5')];
  it('refuses a fifth look; existing owners are fine; sharers do not count', () => {
    expect(setFaceSource(four, 's5', 'look', make)).toBe(four);
    expect(setFaceSource(four, 's1', 'look', make)).toBe(four);
    const withSharer = [...four.slice(0, 4), sharer('s5', 's1')];
    expect(canStartLook(withSharer)).toBe(false);
    expect(lookOwners(withSharer)).toHaveLength(4);
  });
  it('turns a Video face into an own look', () => {
    const list = [face('s1'), face('s2')];
    const out = setFaceSource(list, 's2', 'look', make);
    expect(out[1]).toEqual(face('s2', { source: 'look', look: lk(99) }));
    expect(out[0]).toBe(list[0]);
  });
  it('promotes the first sharer when an owner leaves look', () => {
    const list = [owner('s1', 5), sharer('s2', 's1'), sharer('s3', 's1'), face('s4')];
    const out = setFaceSource(list, 's1', 'video', make);
    expect(out[0]).toEqual(face('s1'));
    expect(out[1]).toEqual(face('s2', { source: 'look', look: lk(5) }));
    expect(out[2]).toEqual(sharer('s3', 's2'));
    expect(out[3]).toBe(list[3]);
    expect(normalizeSources(out)).toBe(out);
    const pat = setFaceSource(list, 's1', 'pattern', make);
    expect(pat[0]).toEqual(face('s1', { source: 'pattern' }));
    expect(pat[1].look).toEqual(lk(5));
  });
  it('a sharer leaving look disturbs nobody', () => {
    const list = [owner('s1'), sharer('s2', 's1'), sharer('s3', 's1')];
    const out = setFaceSource(list, 's2', 'video', make);
    expect(out[0]).toBe(list[0]);
    expect(out[2]).toBe(list[2]);
  });
  it('no-op changes return the same list', () => {
    const list = [face('s1'), face('s2', { source: 'pattern' })];
    expect(setFaceSource(list, 's1', 'video', make)).toBe(list);
    expect(setFaceSource(list, 's2', 'pattern', make)).toBe(list);
    expect(setFaceSource(list, 'zz', 'look', make)).toBe(list);
  });
});

describe('shareLook', () => {
  it('shares an owner and drops the face own look', () => {
    const out = shareLook([owner('s1'), owner('s2')], 's2', 's1');
    expect(out[1]).toEqual(sharer('s2', 's1'));
  });
  it('refuses a non-owner target, itself, a missing face, or a repeat', () => {
    const list = [owner('s1'), face('s2'), sharer('s3', 's1')];
    expect(shareLook(list, 's1', 's2')).toBe(list);
    expect(shareLook(list, 's1', 's1')).toBe(list);
    expect(shareLook(list, 's2', 's3')).toBe(list);
    expect(shareLook(list, 's2', 'zz')).toBe(list);
    expect(shareLook(list, 'zz', 's1')).toBe(list);
    expect(shareLook(list, 's3', 's1')).toBe(list);
  });
  it('an owner with sharers hands its look over before joining another', () => {
    const list = [owner('s1', 1), owner('s2', 2), sharer('s3', 's2'), sharer('s4', 's2')];
    const out = shareLook(list, 's2', 's1');
    expect(out[1]).toEqual(sharer('s2', 's1'));
    expect(out[2]).toEqual(face('s3', { source: 'look', look: lk(2) }));
    expect(out[3]).toEqual(sharer('s4', 's3'));
    expect(normalizeSources(out)).toBe(out);
  });
});

describe('setOwnLook', () => {
  it('writes only on an owner and keeps the list when unchanged', () => {
    const list = [owner('s1', 1), sharer('s2', 's1'), face('s3')];
    expect(setOwnLook(list, 's1', lk(1))).toBe(list);
    expect(setOwnLook(list, 's2', lk(2))).toBe(list);
    expect(setOwnLook(list, 's3', lk(2))).toBe(list);
    const out = setOwnLook(list, 's1', lk(2));
    expect(out[0].look).toEqual(lk(2));
    expect(out[1]).toBe(list[1]);
  });
});
