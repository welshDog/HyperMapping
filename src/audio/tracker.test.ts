import { describe, expect, it } from 'vitest';
import { GATE_CLOSE, GATE_OPEN, NOISE_GATE, createLevelTracker, type LevelTracker } from './tracker';

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
  it('rises faster than it falls (equal-size steps)', () => {
    // A constant input settles at target = sensitivity (peak = input). Steps of 0.5 up and down:
    const down = createLevelTracker();
    const high = run(down, 0.5, 200, 1).bass; // settled at 1
    const fall = high - down.update(sig(0.5), 0.5).bass; // target 0.5
    const up = createLevelTracker();
    const low = run(up, 0.5, 200, 0.5).bass; // settled at 0.5
    const rise = up.update(sig(0.5), 1).bass - low; // target 1
    expect(rise).toBeGreaterThan(3 * fall);
  });
  it('gate has hysteresis: open above GATE_OPEN, close below GATE_CLOSE, hold in between', () => {
    expect(NOISE_GATE).toBe(GATE_OPEN);
    const mid = (GATE_OPEN + GATE_CLOSE) / 2;
    const closed = createLevelTracker();
    expect(run(closed, mid, 20).bass).toBe(0); // hovering between: stays closed
    const t = createLevelTracker();
    expect(run(t, GATE_OPEN + 0.01, 20).bass).toBeGreaterThan(0.5); // crossing opens
    expect(run(t, mid, 20).bass).toBeGreaterThan(0.5); // hovering between: stays open, no flap
    expect(run(t, GATE_CLOSE - 0.01, 60).bass).toBeLessThan(0.01); // falling under closes
    expect(run(t, mid, 20).bass).toBeLessThan(0.01); // and stays closed
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
