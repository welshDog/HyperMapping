import { describe, it, expect } from 'vitest';
import { sliceAspect } from './slice-aspect';

const PATTERN = 16 / 9;
const portrait = { width: 720, height: 1280 };
const square = { width: 500, height: 500 };

describe('sliceAspect', () => {
  it('uses the video shape when a video is loaded and the pattern is off', () => {
    expect(sliceAspect({ force: false, patternAvailable: true, video: portrait })).toBeCloseTo(720 / 1280);
    expect(sliceAspect({ force: false, patternAvailable: true, video: square })).toBe(1);
  });

  it('uses the pattern shape (16:9) when the pattern is forced on over a video', () => {
    expect(sliceAspect({ force: true, patternAvailable: true, video: portrait })).toBeCloseTo(PATTERN);
  });

  it('uses the pattern shape when no video is loaded and the pattern is available', () => {
    expect(sliceAspect({ force: false, patternAvailable: true, video: null })).toBeCloseTo(PATTERN);
    expect(sliceAspect({ force: true, patternAvailable: true, video: null })).toBeCloseTo(PATTERN);
  });

  it('falls back to the video shape when the pattern is wanted but the browser cannot make it', () => {
    expect(sliceAspect({ force: true, patternAvailable: false, video: portrait })).toBeCloseTo(720 / 1280);
  });

  it('falls back to 16:9 when nothing is showing', () => {
    expect(sliceAspect({ force: true, patternAvailable: false, video: null })).toBeCloseTo(PATTERN);
    expect(sliceAspect({ force: false, patternAvailable: false, video: null })).toBeCloseTo(PATTERN);
  });

  it('ignores a video that has no size yet (metadata not loaded)', () => {
    expect(sliceAspect({ force: false, patternAvailable: true, video: { width: 0, height: 0 } })).toBeCloseTo(PATTERN);
    expect(sliceAspect({ force: false, patternAvailable: false, video: { width: 0, height: 720 } })).toBeCloseTo(PATTERN);
  });
});
