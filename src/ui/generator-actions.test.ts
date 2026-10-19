import { describe, expect, it } from 'vitest';
import { lookToCode, type Look } from '../generator/look';
import { initialState, isValidState, shuffleDue } from '../generator/shuffle';
import { applyCode, pickStyle, randomizeLook, setShuffle } from './generator-actions';

const base = { ...initialState(1000, () => 0.3), on: true }; // a look is always on

describe('time fields are preserved', () => {
  const s = { ...base, speed: 1.7, timeAnchor: 42, speedChangedAt: 777 };
  const keep = (n: typeof s) => {
    expect(n.speed).toBe(1.7);
    expect(n.timeAnchor).toBe(42);
    expect(n.speedChangedAt).toBe(777);
  };
  it('pickStyle', () => keep(pickStyle(s, 'neon', 5000, () => 0.4)));
  it('setShuffle', () => keep(setShuffle(s, 30, 5000)));
  it('randomizeLook', () => keep(randomizeLook(s, 5000, () => 0.6)));
});

describe('randomizeLook', () => {
  it('cross-fades to a different look and keeps the clocks and time fields', () => {
    const s = randomizeLook(base, 9000, Math.random);
    expect(s.on).toBe(true);
    expect(s.startedAt).toBe(base.startedAt);
    expect(s.timeAnchor).toBe(base.timeAnchor);
    expect(s.look).not.toEqual(base.look);
    expect(s.prev).toEqual(base.look);
    expect(s.changedAt).toBe(9000);
    expect(isValidState(s)).toBe(true);
  });
  it('keeps startedAt of a running look', () => {
    const on = { ...base, startedAt: 500 };
    expect(randomizeLook(on, 9000, Math.random).startedAt).toBe(500);
  });
});

describe('applyCode', () => {
  const look: Look = { style: 'kaleidoscope', seed: 0x7f3a92c1 };
  it('accepts a good code with a cross-fade and keeps the clocks', () => {
    const r = applyCode(base, `  ${lookToCode(look).toLowerCase()} `, 9000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.look).toEqual(look);
    expect(r.state.prev).toEqual(base.look);
    expect(r.state.changedAt).toBe(9000);
    expect(r.state.startedAt).toBe(base.startedAt);
    expect(r.state.on).toBe(true);
  });
  it('rejects garbage without throwing', () => {
    for (const bad of ['', 'nope', 'K-7F3A92C1D', 'K-7F3A92C1B9', '\u0000', 'x'.repeat(5000)]) {
      expect(applyCode(base, bad, 9000).ok).toBe(false);
    }
    expect(applyCode(base, null as unknown as string, 9000).ok).toBe(false);
  });
});

describe('pickStyle', () => {
  const on = { ...base, on: true, look: { style: 'plasma' as const, seed: 3 }, changedAt: 100 };
  it('on + different fixed style cross-fades to that style', () => {
    const s = pickStyle(on, 'neon', 9000, Math.random);
    expect(s.look.style).toBe('neon');
    expect(s.prev).toEqual(on.look);
    expect(s.changedAt).toBe(9000);
    expect(s.stylePick).toBe('neon');
    expect(isValidState(s)).toBe(true);
  });
  it('same style keeps the look', () => {
    const s = pickStyle(on, 'plasma', 9000, Math.random);
    expect(s.look).toEqual(on.look);
    expect(s.changedAt).toBe(100);
    expect(s.stylePick).toBe('plasma');
  });
  it('auto only changes stylePick', () => {
    const s = pickStyle({ ...on, stylePick: 'neon' }, 'auto', 9000, Math.random);
    expect(s).toEqual({ ...on, stylePick: 'auto' });
    expect(isValidState(s)).toBe(true);
  });
});

describe('setShuffle', () => {
  it('changing the time after a long while does not make a shuffle due', () => {
    const old = { ...base, on: true, shuffleSec: 15 as const, changedAt: 0 };
    const now = 120_000;
    expect(shuffleDue(old, now)).toBe(true);
    const s = setShuffle(old, 30, now);
    expect(s.shuffleSec).toBe(30);
    expect(s.prev).toBeNull();
    expect(shuffleDue(s, now)).toBe(false);
    expect(isValidState(s)).toBe(true);
  });
  it('a mid-fade change keeps prev and changedAt', () => {
    const prev = { style: 'neon' as const, seed: 9 };
    const fading = { ...base, on: true, shuffleSec: 15 as const, prev, changedAt: 9000 };
    const s = setShuffle(fading, 60, 9500);
    expect(s.prev).toEqual(prev);
    expect(s.changedAt).toBe(9000);
    expect(s.shuffleSec).toBe(60);
  });
  it('the same value returns the same state', () => {
    expect(setShuffle(base, base.shuffleSec, 5)).toBe(base);
  });
});
