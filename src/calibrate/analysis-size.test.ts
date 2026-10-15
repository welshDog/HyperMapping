import { describe, it, expect } from 'vitest';
import { analysisSize } from './analysis-size';

describe('analysisSize', () => {
  it('keeps landscape 1280x720 at 640x360', () => {
    expect(analysisSize(1280, 720)).toEqual({ w: 640, h: 360 });
  });
  it('bounds portrait by pixel count and keeps the aspect', () => {
    const { w, h } = analysisSize(720, 1280);
    expect(w * h).toBeLessThanOrEqual(400_000);
    expect(Math.abs(h - (w * 1280) / 720)).toBeLessThanOrEqual(1);
  });
  it('handles square', () => {
    expect(analysisSize(1000, 1000)).toEqual({ w: 632, h: 632 });
  });
  it('does not upscale a tiny video', () => {
    expect(analysisSize(320, 240)).toEqual({ w: 320, h: 240 });
  });
  it('keeps the base64 result well under the 4,000,000 body cap for common phone resolutions', () => {
    for (const [vw, vh] of [[1280, 720], [720, 1280], [1920, 1080], [1080, 1920], [3840, 2160], [2160, 3840], [640, 480], [480, 640]]) {
      const { w, h } = analysisSize(vw, vh);
      expect(Math.ceil((w * h * 5 * 4) / 3)).toBeLessThan(2_700_000);
    }
  });
  it('throws on zero or NaN', () => {
    expect(() => analysisSize(0, 720)).toThrow();
    expect(() => analysisSize(1280, 0)).toThrow();
    expect(() => analysisSize(NaN, 720)).toThrow();
  });
});
