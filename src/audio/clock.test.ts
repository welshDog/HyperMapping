import { describe, expect, it } from 'vitest';
import { createAudioClock } from './clock';
import { STALE_END_MS, VOLUME_SPEEDUP, stepAudioTime } from './motion';

const ZERO = { pulse: 0, treble: 0, atime: 0 };

describe('createAudioClock', () => {
  it('gives zeros before any audio arrives, however many frames pass', () => {
    const c = createAudioClock();
    for (let t = 0; t <= 2000; t += 33) expect(c.frame(t)).toEqual(ZERO);
  });

  it('passes fresh bass and treble through as pulse and treble', () => {
    const c = createAudioClock();
    c.setAudio({ bass: 0.7, treble: 0.3, vol: 0 }, 1000);
    expect(c.frame(1010)).toEqual({ pulse: 0.7, treble: 0.3, atime: 0 });
  });

  it('accumulates atime at the stepAudioTime rate with steady vol 1', () => {
    const c = createAudioClock();
    let expected = { smooth: 0, atime: 0 };
    let out = c.frame(0); // first frame: dt 0
    for (let i = 1; i <= 60; i++) {
      const t = i * 33;
      c.setAudio({ bass: 0, treble: 0, vol: 1 }, t - 5);
      out = c.frame(t);
      expected = stepAudioTime(expected, 1, 0.033);
    }
    expect(out.atime).toBeCloseTo(expected.atime, 9);
    // after ~2 s the smoother has settled: the rate approaches VOLUME_SPEEDUP seconds per second
    const before = out.atime;
    c.setAudio({ bass: 0, treble: 0, vol: 1 }, 61 * 33 - 5);
    const after = c.frame(61 * 33).atime;
    expect((after - before) / 0.033).toBeCloseTo(VOLUME_SPEEDUP, 2);
  });

  it('fades stale audio to zero by the stale end', () => {
    const c = createAudioClock();
    c.setAudio({ bass: 1, treble: 1, vol: 1 }, 0);
    const mid = c.frame(250);
    expect(mid.pulse).toBeGreaterThan(0);
    expect(mid.pulse).toBeLessThan(1);
    const end = c.frame(STALE_END_MS);
    expect(end.pulse).toBe(0);
    expect(end.treble).toBe(0);
    const later = c.frame(STALE_END_MS + 1000);
    expect(later.pulse).toBe(0);
  });

  it('adds no time for the gap after idle(), and keeps atime (no jump)', () => {
    const c = createAudioClock();
    c.frame(0);
    for (let t = 33; t <= 990; t += 33) {
      c.setAudio({ bass: 0, treble: 0, vol: 1 }, t);
      c.frame(t);
    }
    const kept = c.frame(1000).atime;
    expect(kept).toBeGreaterThan(0);
    c.idle();
    c.setAudio({ bass: 0, treble: 0, vol: 1 }, 60_000);
    expect(c.frame(60_000).atime).toBe(kept); // first frame of the new run: dt 0
    expect(c.frame(60_033).atime).toBeGreaterThan(kept); // then it continues
  });

  it('clamps out-of-range levels and cleans NaN/Infinity', () => {
    const c = createAudioClock();
    c.setAudio({ bass: 5, treble: -2, vol: Number.NaN }, 0);
    expect(c.frame(0)).toEqual({ pulse: 1, treble: 0, atime: 0 });
    c.setAudio({ bass: Number.NaN, treble: Number.POSITIVE_INFINITY, vol: 0.5 }, 10);
    const f = c.frame(10);
    expect(f.pulse).toBe(0);
    expect(f.treble).toBe(0);
    expect(Number.isFinite(f.atime)).toBe(true);
  });

  it('never lets atime decrease, even with time going backwards or wild levels', () => {
    const c = createAudioClock();
    let prev = c.frame(0).atime;
    const times = [33, 66, 50, 400, 399, 2000, 1999, 2033, 5000];
    times.forEach((t, i) => {
      c.setAudio({ bass: i % 2, treble: 0.5, vol: [1, 0, 0.3, Number.NaN, 2][i % 5] }, t);
      const a = c.frame(t).atime;
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    });
  });
});
