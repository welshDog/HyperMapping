import { describe, it, expect } from 'vitest';
import { isVideoReady } from './video-ready';

describe('isVideoReady', () => {
  it('is true once a frame is available and the video has size', () => {
    expect(isVideoReady({ readyState: 4, videoWidth: 1920, videoHeight: 1080 })).toBe(true);
    expect(isVideoReady({ readyState: 2, videoWidth: 640, videoHeight: 360 })).toBe(true);
  });
  it('is false while still loading metadata only', () => {
    expect(isVideoReady({ readyState: 1, videoWidth: 1920, videoHeight: 1080 })).toBe(false);
  });
  it('is false for a zero-sized video', () => {
    expect(isVideoReady({ readyState: 4, videoWidth: 0, videoHeight: 0 })).toBe(false);
  });
});
