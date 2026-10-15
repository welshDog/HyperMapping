import { describe, expect, it } from 'vitest';
import { createLevelTracker, type LevelTracker } from './tracker';

const sig = (v: number) => ({ bass: v, mid: v, treble: v, volume: v });
function run(t: LevelTracker, v: number, n: number, sens?: number) {
  let o = t.update(sig(v), sens);
  for (let i = 1; i < n; i++) o = t.update(sig(v), sens);
  return o;
}

describe('createLevelTracker', () => {
  it('quiet and loud constants both reach full scale (adaptive gain)', () => {
    const q = run(createLevelTracker(), 0.1, 200).bass;
    const l = run(createLevelTracker(), 0.8, 200).bass;
    expect(q).toBeGreaterThanOrEqual(0.9);
    expect(l).toBeGreaterThanOrEqual(0.9);
  });
  it('below the noise gate outputs 0 and the peak does not climb', () => {
    const t = createLevelTracker();
    expect(run(t, 0.02, 50)).toEqual({ bass: 0, mid: 0, treble: 0, volume: 0 });
    // loud bass but gated volume: the peak must not rise
    for (let i = 0; i < 50; i++) t.update({ bass: 0.9, mid: 0, treble: 0, volume: 0.02 });
    expect(run(t, 0.1, 60).bass).toBeGreaterThanOrEqual(0.9);
  });
  it('rises faster than it falls', () => {
    const t = createLevelTracker();
    run(t, 0.5, 100); // settled near 1
    const settled = t.update(sig(0.5)).bass;
    const fall = settled - t.update(sig(0.0801)).bass; // quiet but above the gate
    const rise = createLevelTracker().update(sig(0.5)).bass - 0; // first frame up from 0
    expect(rise).toBeGreaterThan(fall);
  });
  it('sensitivity scales up (capped at 1) and down', () => {
    const settle = (s: number) => {
      const t = createLevelTracker();
      run(t, 0.5, 100, 1);
      return run(t, 0.25, 80, s).bass;
    };
    expect(settle(2)).toBeGreaterThanOrEqual(settle(1));
    expect(settle(3)).toBeLessThanOrEqual(1);
    expect(settle(0.2)).toBeLessThan(settle(1));
  });
  it('outputs stay within 0..1', () => {
    const t = createLevelTracker();
    for (let i = 0; i < 300; i++) {
      const o = t.update(sig((Math.sin(i / 3) + 1) / 2), 3);
      for (const x of Object.values(o)) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(1);
      }
    }
  });
  it('reset clears state', () => {
    const t = createLevelTracker();
    run(t, 0.8, 100);
    t.reset();
    const fresh = createLevelTracker();
    expect(t.update(sig(0.1))).toEqual(fresh.update(sig(0.1)));
    expect(t.update(sig(0.9))).toEqual(fresh.update(sig(0.9)));
  });
  it('NaN and negative inputs are treated as 0', () => {
    const t = createLevelTracker();
    run(t, 0.5, 20);
    const o = t.update({ bass: NaN, mid: -1, treble: -Infinity, volume: -5 });
    for (const x of Object.values(o)) {
      expect(Number.isNaN(x)).toBe(false);
      expect(x).toBeGreaterThanOrEqual(0);
    }
    for (const x of Object.values(run(t, NaN, 5))) expect(Number.isNaN(x)).toBe(false);
  });
});
