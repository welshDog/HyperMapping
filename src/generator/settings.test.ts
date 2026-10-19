import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LOOK_SETTINGS, newLookSettings, parseLookSettings, sameSettings, settingsFromState,
  stateFromSettings, isValidLookSettings, type LookSettings,
} from './settings';
import { mulberry32 } from './random';

const good: LookSettings = { look: { style: 'neon', seed: 77 }, speed: 1.5, shuffleSec: 30, stylePick: 'neon' };

describe('DEFAULT_LOOK_SETTINGS', () => {
  it('matches the spec', () => {
    expect(DEFAULT_LOOK_SETTINGS).toEqual({ look: { style: 'plasma', seed: 1 }, speed: 1, shuffleSec: 0, stylePick: 'auto' });
  });
});

describe('parseLookSettings', () => {
  it('accepts a valid object and drops unknown keys', () => {
    const out = parseLookSettings({ ...good, extra: 1, look: { ...good.look, junk: true } });
    expect(out).toEqual(good);
    expect(out && 'extra' in out).toBe(false);
    expect(out && 'junk' in out.look).toBe(false);
  });
  it('rejects bad fields', () => {
    expect(parseLookSettings({ ...good, look: { style: 'bad', seed: 1 } })).toBeNull();
    expect(parseLookSettings({ ...good, look: { style: 'neon', seed: NaN } })).toBeNull();
    expect(parseLookSettings({ ...good, speed: 0.1 })).toBeNull();
    expect(parseLookSettings({ ...good, speed: 2.5 })).toBeNull();
    expect(parseLookSettings({ ...good, shuffleSec: 7 })).toBeNull();
    expect(parseLookSettings({ ...good, stylePick: 'x' })).toBeNull();
    expect(parseLookSettings(null)).toBeNull();
    expect(parseLookSettings('no')).toBeNull();
  });
  it('isValidLookSettings agrees', () => {
    expect(isValidLookSettings(good)).toBe(true);
    expect(isValidLookSettings({ ...good, speed: NaN })).toBe(false);
  });
});

describe('stateFromSettings / settingsFromState', () => {
  it('builds a live fresh state', () => {
    const s = stateFromSettings(good, 5);
    expect(s.on).toBe(true);
    expect(s.prev).toBeNull();
    expect(s.timeAnchor).toBe(0);
    expect([s.changedAt, s.startedAt, s.speedChangedAt]).toEqual([5, 5, 5]);
  });
  it('round-trips', () => {
    expect(settingsFromState(stateFromSettings(good, 5))).toEqual(good);
  });
});

describe('newLookSettings', () => {
  it('copies speed/shuffle/pick from base and changes the look', () => {
    const out = newLookSettings(mulberry32(3), good);
    expect(out.speed).toBe(1.5);
    expect(out.shuffleSec).toBe(30);
    expect(out.stylePick).toBe('neon');
    expect(out.look).not.toEqual(good.look);
  });
  it('uses defaults without a base', () => {
    const out = newLookSettings(mulberry32(3));
    expect([out.speed, out.shuffleSec, out.stylePick]).toEqual([1, 0, 'auto']);
  });
});

describe('sameSettings', () => {
  it('compares by value', () => {
    expect(sameSettings(good, { ...good, look: { ...good.look } })).toBe(true);
    expect(sameSettings(good, { ...good, speed: 1 })).toBe(false);
    expect(sameSettings(good, { ...good, look: { style: 'neon', seed: 78 } })).toBe(false);
  });
});
