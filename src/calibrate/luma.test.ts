import { describe, it, expect } from 'vitest';
import { accumulateLuma, finishLuma } from './luma';

describe('luma', () => {
  it('turns RGBA into grey with the usual weights', () => {
    const acc = new Uint16Array(3);
    accumulateLuma(Uint8ClampedArray.from([255, 255, 255, 255, 255, 0, 0, 255, 0, 0, 0, 255]), acc);
    const out = finishLuma(acc, 1);
    expect(out[0]).toBe(255);
    expect(out[1]).toBe(76); // red: (77 * 255) >> 8
    expect(out[2]).toBe(0);
  });
  it('averages several frames', () => {
    const acc = new Uint16Array(1);
    accumulateLuma(Uint8ClampedArray.from([100, 100, 100, 255]), acc);
    accumulateLuma(Uint8ClampedArray.from([200, 200, 200, 255]), acc);
    accumulateLuma(Uint8ClampedArray.from([150, 150, 150, 255]), acc);
    expect(finishLuma(acc, 3)[0]).toBe(150);
  });
});
