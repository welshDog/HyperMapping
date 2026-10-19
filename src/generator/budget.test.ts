import { describe, expect, it } from 'vitest';
import { chooseLookSize, lookRenderSize } from './budget';

describe('lookRenderSize', () => {
  it('keeps the full 960x540 for 0..2 live looks', () => {
    for (const n of [0, 1, 2]) expect(lookRenderSize(n)).toEqual({ w: 960, h: 540 });
  });
  it('drops to 640x360 for 3..4 live looks', () => {
    for (const n of [3, 4]) expect(lookRenderSize(n)).toEqual({ w: 640, h: 360 });
  });
  it('never goes below 640x360, even past the cap', () => {
    expect(lookRenderSize(9)).toEqual({ w: 640, h: 360 });
  });
  it('treats negative or fractional counts sanely', () => {
    expect(lookRenderSize(-1)).toEqual({ w: 960, h: 540 });
    expect(lookRenderSize(2.5)).toEqual({ w: 960, h: 540 });
    expect(lookRenderSize(3)).toEqual({ w: 640, h: 360 });
  });
});

describe('chooseLookSize (hysteresis)', () => {
  const FULL = { w: 960, h: 540 };
  const SMALL = { w: 640, h: 360 };
  it('starts from the plain rule when there is no current size', () => {
    expect(chooseLookSize(null, 0)).toEqual(FULL);
    expect(chooseLookSize(null, 2)).toEqual(FULL);
    expect(chooseLookSize(null, 3)).toEqual(SMALL);
  });
  it('shrinks at 3 looks and only grows back at 1 or fewer, so 2 looks never flap', () => {
    let size = chooseLookSize(null, 2);
    size = chooseLookSize(size, 3);
    expect(size).toEqual(SMALL);
    size = chooseLookSize(size, 2); // would have been FULL without hysteresis
    expect(size).toEqual(SMALL);
    size = chooseLookSize(size, 3);
    expect(size).toEqual(SMALL);
    size = chooseLookSize(size, 1);
    expect(size).toEqual(FULL);
    size = chooseLookSize(size, 2);
    expect(size).toEqual(FULL);
  });
  it('never goes below 640x360 and always returns a fresh object', () => {
    const a = chooseLookSize(FULL, 9);
    expect(a).toEqual(SMALL);
    expect(chooseLookSize(a, 9)).not.toBe(a);
  });
});
