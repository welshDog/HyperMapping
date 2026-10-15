import { describe, expect, it } from 'vitest';
import { STALE_END_MS, STALE_START_MS, VOLUME_SPEEDUP, fadeLevels, stepAudioTime } from './motion';

const L = { bass: 0.8, treble: 0.4, vol: 0.6 };

describe('fadeLevels', () => {
  it('unchanged up to the stale start and for negative age', () => {
    for (const a of [0, 50, STALE_START_MS, -10]) expect(fadeLevels(L, a)).toEqual(L);
  });
  it('halves at 250 ms', () => {
    const f = fadeLevels(L, 250);
    expect(f.bass).toBeCloseTo(0.4, 9);
    expect(f.treble).toBeCloseTo(0.2, 9);
    expect(f.vol).toBeCloseTo(0.3, 9);
  });
  it('zero at and beyond the stale end, never negative', () => {
    for (const a of [STALE_END_MS, 1000, 1e9]) expect(fadeLevels(L, a)).toEqual({ bass: 0, treble: 0, vol: 0 });
  });
});

describe('stepAudioTime', () => {
  it('silence does not move time', () => {
    expect(stepAudioTime({ smooth: 0, atime: 3 }, 0, 0.033)).toEqual({ smooth: 0, atime: 3 });
  });
  it('vol 1 for 1 s follows the formula', () => {
    let s = { smooth: 0, atime: 0 };
    let smooth = 0;
    let atime = 0;
    for (let i = 0; i < 30; i++) {
      s = stepAudioTime(s, 1, 0.033);
      smooth += (1 - smooth) * Math.min(1, 0.033 * 8);
      atime += 0.033 * VOLUME_SPEEDUP * smooth;
    }
    expect(s.atime).toBeCloseTo(atime, 9);
    expect(s.atime).toBeGreaterThan(1.1);
    expect(s.atime).toBeLessThan(1.5);
  });
  it('never decreases', () => {
    let s = { smooth: 0.5, atime: 1 };
    for (const v of [1, 0, 0.3, 0, 0]) {
      const n = stepAudioTime(s, v, 0.033);
      expect(n.atime).toBeGreaterThanOrEqual(s.atime);
      s = n;
    }
  });
  it('bad dt changes nothing', () => {
    const p = { smooth: 0.2, atime: 1 };
    for (const dt of [0, -1, NaN]) expect(stepAudioTime(p, 1, dt)).toEqual(p);
  });
  it('huge dt is clamped to 0.25 s', () => {
    const a = stepAudioTime({ smooth: 1, atime: 0 }, 1, 5);
    const b = stepAudioTime({ smooth: 1, atime: 0 }, 1, 0.25);
    expect(a).toEqual(b);
    expect(a.atime).toBeCloseTo(0.25 * VOLUME_SPEEDUP, 9);
  });
});
