import { describe, expect, it } from 'vitest';
import { DEFAULT_AUDIO_SETTINGS } from './settings';
import {
  BEAT_LOOK_MIN_MS,
  LEVEL_PUBLISH_MS,
  createLevelThrottle,
  scaleBySensitivity,
  shouldBeatRandomize,
} from './reactor-logic';

const base = {
  beat: true,
  settings: { ...DEFAULT_AUDIO_SETTINGS, beatLook: true },
  generatorOn: true,
  listening: true,
  now: 10000,
  changedAt: 0,
};

describe('shouldBeatRandomize', () => {
  it('fires when everything allows it', () => {
    expect(shouldBeatRandomize(base)).toBe(true);
  });
  it('needs a beat', () => expect(shouldBeatRandomize({ ...base, beat: false })).toBe(false));
  it('needs the beatLook option', () =>
    expect(shouldBeatRandomize({ ...base, settings: { ...base.settings, beatLook: false } })).toBe(false));
  it('needs the generator on', () => expect(shouldBeatRandomize({ ...base, generatorOn: false })).toBe(false));
  it('needs listening', () => expect(shouldBeatRandomize({ ...base, listening: false })).toBe(false));
  it('respects the minimum gap exactly', () => {
    expect(shouldBeatRandomize({ ...base, now: BEAT_LOOK_MIN_MS - 1, changedAt: 0 })).toBe(false);
    expect(shouldBeatRandomize({ ...base, now: BEAT_LOOK_MIN_MS, changedAt: 0 })).toBe(true);
  });
  it('does not fire on a non-finite clock', () => {
    expect(shouldBeatRandomize({ ...base, now: NaN })).toBe(false);
    expect(shouldBeatRandomize({ ...base, changedAt: NaN })).toBe(false);
  });
});

describe('scaleBySensitivity', () => {
  it('multiplies and clamps to 0..1', () => {
    expect(scaleBySensitivity({ bass: 0.5, mid: 0.2, treble: 0.9, volume: 0.1 }, 2)).toEqual({
      bass: 1,
      mid: 0.4,
      treble: 1,
      volume: 0.2,
    });
  });
  it('treats a bad sensitivity as 1', () => {
    expect(scaleBySensitivity({ bass: 0.5, mid: 0, treble: 0, volume: 0 }, NaN).bass).toBe(0.5);
  });
});

describe('createLevelThrottle', () => {
  it('lets the first call through, then at most one per interval', () => {
    const t = createLevelThrottle();
    expect(t.due(1000)).toBe(true);
    expect(t.due(1000 + LEVEL_PUBLISH_MS - 1)).toBe(false);
    expect(t.due(1000 + LEVEL_PUBLISH_MS)).toBe(true);
    expect(t.due(1000 + LEVEL_PUBLISH_MS + 10)).toBe(false);
  });
  it('reset lets the next call through; a backwards clock does not wedge it', () => {
    const t = createLevelThrottle();
    t.due(5000);
    expect(t.due(5001)).toBe(false);
    t.reset();
    expect(t.due(5002)).toBe(true);
    expect(t.due(10)).toBe(true); // clock went backwards
  });
  it('about 10 per second at 33 ms frames', () => {
    const t = createLevelThrottle();
    let n = 0;
    for (let ms = 0; ms < 1000; ms += 33) if (t.due(ms)) n++;
    expect(n).toBeLessThanOrEqual(10);
    expect(n).toBeGreaterThanOrEqual(8);
  });
});
