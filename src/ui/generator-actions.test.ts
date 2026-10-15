import { describe, expect, it } from 'vitest';
import { lookToCode, type Look } from '../generator/look';
import { initialState, isValidState, shuffleDue } from '../generator/shuffle';
import { applyCode, pickStyle, randomizeOn, setOn, setShuffle } from './generator-actions';

const base = { ...initialState(1000, () => 0.3) };

describe('setOn', () => {
  it('turning on resets both clocks to now and drops a stale fade', () => {
    const s = setOn({ ...base, prev: { style: 'neon', seed: 5 } }, true, 9000);
    expect(s.on).toBe(true);
    expect(s.startedAt).toBe(9000);
    expect(s.changedAt).toBe(9000);
    expect(s.prev).toBeNull();
  });
  it('turning on also restarts the shader time and keeps speed', () => {
    const s = setOn({ ...base, speed: 2, timeAnchor: 40, speedChangedAt: 3 }, true, 9000);
    expect(s.timeAnchor).toBe(0);
    expect(s.speedChangedAt).toBe(9000);
    expect(s.speed).toBe(2);
  });
  it('turning off leaves the time fields', () => {
    const on = { ...base, on: true, speed: 2, timeAnchor: 40, speedChangedAt: 3 };
    const s = setOn(on, false, 9000);
    expect(s.timeAnchor).toBe(40);
    expect(s.speedChangedAt).toBe(3);
  });
  it('turning on when already on changes nothing (no visual jump)', () => {
    const on = { ...base, on: true };
    expect(setOn(on, true, 9000)).toBe(on);
  });
  it('turning off keeps the clocks', () => {
    const on = { ...base, on: true, startedAt: 5, changedAt: 6 };
    const s = setOn(on, false, 9000);
    expect(s).toEqual({ ...on, on: false });
  });
});

describe('randomizeOn', () => {
  it('turns on with fresh clocks and a different look', () => {
    const s = randomizeOn(base, 9000, Math.random);
    expect(s.on).toBe(true);
    expect(s.startedAt).toBe(9000);
    expect(s.changedAt).toBe(9000);
    expect(s.look).not.toEqual(base.look);
    expect(s.prev).toEqual(base.look);
  });
  it('keeps startedAt when already on', () => {
    const on = { ...base, on: true, startedAt: 500 };
    expect(randomizeOn(on, 9000, Math.random).startedAt).toBe(500);
  });
});

describe('applyCode', () => {
  const look: Look = { style: 'kaleidoscope', seed: 0x7f3a92c1 };
  it('accepts a good code with a cross-fade and turns on', () => {
    const r = applyCode(base, `  ${lookToCode(look).toLowerCase()} `, 9000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.look).toEqual(look);
    expect(r.state.prev).toEqual(base.look);
    expect(r.state.changedAt).toBe(9000);
    expect(r.state.startedAt).toBe(9000);
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
  it('off only changes stylePick', () => {
    const off = { ...on, on: false };
    expect(pickStyle(off, 'neon', 9000, Math.random)).toEqual({ ...off, stylePick: 'neon' });
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
