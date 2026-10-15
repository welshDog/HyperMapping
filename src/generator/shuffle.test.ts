import { describe, expect, it } from 'vitest';
import {
  FADE_MS, SHUFFLE_CHOICES, currentLook, fadeAmount, initialState, isValidState,
  randomizeState, shuffleDue, type GeneratorState,
} from './shuffle';
import { mulberry32 } from './random';

const base = (): GeneratorState => initialState(1000, mulberry32(1));

describe('constants', () => {
  it('match the spec', () => {
    expect(FADE_MS).toBe(1500);
    expect([...SHUFFLE_CHOICES]).toEqual([0, 15, 30, 60]);
  });
});

describe('fadeAmount', () => {
  it('is 0 at start and 1 at/after FADE_MS', () => {
    expect(fadeAmount(100, 100)).toBe(0);
    expect(fadeAmount(100 + FADE_MS, 100)).toBe(1);
    expect(fadeAmount(100 + FADE_MS * 5, 100)).toBe(1);
  });
  it('is monotonic', () => {
    let last = -1;
    for (let t = 0; t <= FADE_MS; t += 25) {
      const f = fadeAmount(t, 0);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
  });
  it('smoothstep midpoint is 0.5 and shape is smooth', () => {
    expect(fadeAmount(FADE_MS / 2, 0)).toBeCloseTo(0.5, 12);
    expect(fadeAmount(FADE_MS / 4, 0)).toBeCloseTo(0.15625, 12);
  });
  it('honours a custom duration', () => {
    expect(fadeAmount(500, 0, 1000)).toBeCloseTo(0.5, 12);
  });
  it('is clamped for now < changedAt', () => {
    expect(fadeAmount(0, 5000)).toBe(0);
  });
});

describe('currentLook', () => {
  it('fade 1 and prev null when state.prev is null', () => {
    const s = base();
    expect(currentLook(s, s.changedAt + 10)).toEqual({ prev: null, cur: s.look, fade: 1 });
  });
  it('mid-fade has prev and 0<fade<1', () => {
    const s = randomizeState(base(), 5000, mulberry32(2));
    const c = currentLook(s, 5000 + FADE_MS / 2);
    expect(c.prev).toEqual(s.prev);
    expect(c.cur).toEqual(s.look);
    expect(c.fade).toBeGreaterThan(0);
    expect(c.fade).toBeLessThan(1);
  });
  it('fade 1 and prev null once finished', () => {
    const s = randomizeState(base(), 5000, mulberry32(2));
    expect(currentLook(s, 5000 + FADE_MS)).toEqual({ prev: null, cur: s.look, fade: 1 });
  });
});

describe('randomizeState', () => {
  it('keeps settings, moves look to prev, sets changedAt', () => {
    const s: GeneratorState = { ...base(), on: true, shuffleSec: 30, startedAt: 42, stylePick: 'neon' };
    const n = randomizeState(s, 9000, mulberry32(3));
    expect(n.on).toBe(true);
    expect(n.shuffleSec).toBe(30);
    expect(n.stylePick).toBe('neon');
    expect(n.startedAt).toBe(42);
    expect(n.prev).toEqual(s.look);
    expect(n.changedAt).toBe(9000);
    expect(isValidState(n)).toBe(true);
  });
  it('honours stylePick', () => {
    const r = mulberry32(4);
    let s: GeneratorState = { ...base(), stylePick: 'particles' };
    for (let i = 0; i < 50; i++) {
      s = randomizeState(s, i, r);
      expect(s.look.style).toBe('particles');
    }
  });
  it('is deterministic for a seeded rng', () => {
    expect(randomizeState(base(), 7, mulberry32(9))).toEqual(randomizeState(base(), 7, mulberry32(9)));
  });
  it('never returns the same look as before, even with a stuck rng', () => {
    const s = base();
    const stuck = () => 0; // would draw the same look every time
    const same = { ...s, look: randomizeState(s, 1, stuck).look };
    const n = randomizeState(same, 2, stuck);
    expect(n.look).not.toEqual(same.look);
    const r = mulberry32(10);
    let cur = s;
    for (let i = 0; i < 300; i++) {
      const nx = randomizeState(cur, i, r);
      expect(nx.look).not.toEqual(cur.look);
      cur = nx;
    }
  });
});

describe('shuffleDue', () => {
  it('false when off or shuffleSec 0', () => {
    expect(shuffleDue({ ...base(), on: false, shuffleSec: 15 }, 1e9)).toBe(false);
    expect(shuffleDue({ ...base(), on: true, shuffleSec: 0 }, 1e9)).toBe(false);
  });
  it('false before the interval, true at/after it', () => {
    const s: GeneratorState = { ...base(), on: true, shuffleSec: 15, changedAt: 1000 };
    expect(shuffleDue(s, 1000)).toBe(false);
    expect(shuffleDue(s, 15999)).toBe(false);
    expect(shuffleDue(s, 16000)).toBe(true);
    expect(shuffleDue(s, 99999)).toBe(true);
  });
});

describe('initialState / isValidState', () => {
  it('initialState is off, no prev, shuffle 0, auto', () => {
    const s = initialState(500, mulberry32(1));
    expect(s.on).toBe(false);
    expect(s.prev).toBeNull();
    expect(s.shuffleSec).toBe(0);
    expect(s.stylePick).toBe('auto');
    expect(s.startedAt).toBe(500);
    expect(s.changedAt).toBe(500);
    expect(isValidState(s)).toBe(true);
  });
  it('accepts a state with a prev look', () => {
    expect(isValidState(randomizeState(base(), 10, mulberry32(1)))).toBe(true);
  });
  it('rejects each field broken in turn', () => {
    const s = base();
    const bad: Array<Record<string, unknown>> = [
      { on: 'yes' }, { on: 1 },
      { look: { style: 'fire', seed: 1 } }, { look: null }, { look: { style: 'neon', seed: -1 } },
      { prev: 5 }, { prev: 'x' }, { prev: { style: 'neon' } }, { prev: undefined },
      { changedAt: NaN }, { changedAt: Infinity }, { changedAt: '1' },
      { startedAt: NaN }, { startedAt: -Infinity }, { startedAt: null },
      { shuffleSec: 20 }, { shuffleSec: -15 }, { shuffleSec: '15' }, { shuffleSec: NaN },
      { stylePick: 'fire' }, { stylePick: 3 }, { stylePick: undefined },
    ];
    for (const b of bad) expect(isValidState({ ...s, ...b }), JSON.stringify(b)).toBe(false);
    for (const x of [null, undefined, 5, 'x', []]) expect(isValidState(x)).toBe(false);
  });
});

describe('speed fields', () => {
  it('initialState carries speed 1, timeAnchor 0, speedChangedAt = now', () => {
    const s = initialState(500, mulberry32(1));
    expect(s.speed).toBe(1);
    expect(s.timeAnchor).toBe(0);
    expect(s.speedChangedAt).toBe(500);
    expect(isValidState(s)).toBe(true);
  });
  it('isValidState rejects bad speed fields', () => {
    const s = initialState(500, mulberry32(1));
    const bad: Record<string, unknown>[] = [
      { speed: 0 }, { speed: 5 }, { speed: NaN }, { timeAnchor: -1 }, { timeAnchor: NaN },
      { speedChangedAt: NaN }, { speed: undefined }, { timeAnchor: undefined }, { speedChangedAt: undefined },
    ];
    for (const b of bad) expect(isValidState({ ...s, ...b }), JSON.stringify(b)).toBe(false);
  });
});
