import { describe, expect, it } from 'vitest';
import { lookToCode, type Look } from '../generator/look';
import { initialState } from '../generator/shuffle';
import { applyCode, randomizeOn, setOn } from './generator-actions';

const base = { ...initialState(1000, () => 0.3) };

describe('setOn', () => {
  it('turning on resets both clocks to now and drops a stale fade', () => {
    const s = setOn({ ...base, prev: { style: 'neon', seed: 5 } }, true, 9000);
    expect(s.on).toBe(true);
    expect(s.startedAt).toBe(9000);
    expect(s.changedAt).toBe(9000);
    expect(s.prev).toBeNull();
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
