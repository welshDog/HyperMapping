import { describe, expect, it } from 'vitest';
import { captureFpsFor, lookRenderSize } from './budget';

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
  });
});

describe('captureFpsFor', () => {
  it('stays at 30 for every count', () => {
    for (const n of [0, 1, 2, 3, 4]) expect(captureFpsFor(n)).toBe(30);
  });
});
