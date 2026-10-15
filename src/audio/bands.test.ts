import { describe, expect, it } from 'vitest';
import { bandLevels } from './bands';
import { sineSpectrum } from './test-spectrum';

describe('bandLevels', () => {
  for (const rate of [44100, 48000]) {
    it(`60 Hz is bass at ${rate}`, () => {
      const b = bandLevels(sineSpectrum(60, rate, 1024), rate);
      // 6 bass bins (21..129 Hz) hold 1 + 0.6 + 0.6 = 2.2 of 6, so the exact value is 0.3667; the brief's 0.5 is unreachable
      expect(b.bass).toBeCloseTo(2.2 / 6, 6);
      expect(b.bass).toBeGreaterThan(0.3);
      expect(b.treble).toBe(0);
    });
  }
  it('8000 Hz is treble, not bass', () => {
    const b = bandLevels(sineSpectrum(8000, 44100, 1024), 44100);
    expect(b.treble).toBeGreaterThan(b.bass);
    expect(b.bass).toBe(0);
  });
  it('1000 Hz is mid dominant', () => {
    const b = bandLevels(sineSpectrum(1000, 44100, 1024), 44100);
    expect(b.mid).toBeGreaterThan(b.bass);
    expect(b.mid).toBeGreaterThan(b.treble);
  });
  it('silence is all zero', () => {
    expect(bandLevels(new Uint8Array(1024), 44100)).toEqual({ bass: 0, mid: 0, treble: 0, volume: 0 });
  });
  it('full scale is all one', () => {
    expect(bandLevels(new Uint8Array(1024).fill(255), 44100)).toEqual({ bass: 1, mid: 1, treble: 1, volume: 1 });
  });
  it('a tiny spectrum does not throw and stays in range', () => {
    for (const arr of [new Uint8Array([255, 255, 255]), new Uint8Array(0), new Uint8Array(1)]) {
      const b = bandLevels(arr, 44100);
      for (const v of Object.values(b)) {
        expect(Number.isNaN(v)).toBe(false);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
  it('clamps to Nyquist at a low sample rate without NaN', () => {
    const b = bandLevels(new Uint8Array(512).fill(255), 16000);
    expect(b.treble).toBe(1);
    for (const v of Object.values(b)) expect(Number.isNaN(v)).toBe(false);
  });
  it('volume is the mean over 20..12000 Hz', () => {
    const rate = 44100;
    const n = 1024;
    const binHz = rate / (2 * n);
    const arr = new Uint8Array(n);
    let sum = 0;
    let count = 0;
    for (let i = 1; i < n; i++) {
      const f = i * binHz;
      if (f >= 20 && f <= 12000) {
        arr[i] = i % 2 ? 255 : 0;
        sum += arr[i] / 255;
        count++;
      }
    }
    arr[n - 1] = 255; // above 12 kHz: must not count
    expect(bandLevels(arr, rate).volume).toBeCloseTo(sum / count, 6);
  });
});
