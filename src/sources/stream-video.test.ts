import { describe, it, expect } from 'vitest';
import { HIDDEN_VIDEO_STYLE, createStreamVideo } from './stream-video';

// Node env: the DOM parts (video element, play, dispose) are not unit-testable here.
describe('createStreamVideo', () => {
  it('returns null when captureStream is missing', () => {
    expect(createStreamVideo({} as unknown as HTMLCanvasElement, 10)).toBeNull();
  });
  it('returns null when captureStream throws', () => {
    const canvas = {
      captureStream: () => {
        throw new Error('nope');
      },
    } as unknown as HTMLCanvasElement;
    expect(createStreamVideo(canvas, 10)).toBeNull();
  });
});

describe('HIDDEN_VIDEO_STYLE', () => {
  it('is invisible but not display:none', () => {
    expect(HIDDEN_VIDEO_STYLE).toContain('opacity:0');
    expect(HIDDEN_VIDEO_STYLE).not.toContain('display:none');
  });
});
