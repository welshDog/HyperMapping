import { describe, it, expect } from 'vitest';
import { sliceAspect } from './slice-aspect';

const PATTERN = 16 / 9;

describe('sliceAspect', () => {
  it('look and pattern faces are 16:9, whatever video is loaded', () => {
    expect(sliceAspect({ source: 'look', patternForced: false, videoAspect: 9 / 16 })).toBeCloseTo(PATTERN);
    expect(sliceAspect({ source: 'pattern', patternForced: false, videoAspect: 9 / 16 })).toBeCloseTo(PATTERN);
  });

  it('a Video face uses the loaded video aspect', () => {
    expect(sliceAspect({ source: 'video', patternForced: false, videoAspect: 720 / 1280 })).toBeCloseTo(720 / 1280);
    expect(sliceAspect({ source: 'video', patternForced: false, videoAspect: 1 })).toBe(1);
  });

  it('a forced test pattern is 16:9 even on a Video face', () => {
    expect(sliceAspect({ source: 'video', patternForced: true, videoAspect: 720 / 1280 })).toBeCloseTo(PATTERN);
  });

  it('a Video face with no video (or a video with no size yet) is 16:9', () => {
    expect(sliceAspect({ source: 'video', patternForced: false, videoAspect: null })).toBeCloseTo(PATTERN);
    expect(sliceAspect({ source: 'video', patternForced: false, videoAspect: 0 })).toBeCloseTo(PATTERN);
    expect(sliceAspect({ source: 'video', patternForced: false, videoAspect: NaN })).toBeCloseTo(PATTERN);
  });
});
