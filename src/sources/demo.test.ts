import { describe, it, expect } from 'vitest';
import { DEMO_FILE_NAME, DEMO_VIDEO_PATH, demoVideoUrl } from './demo';

describe('demoVideoUrl', () => {
  it('joins the base and the demo path with exactly one slash', () => {
    expect(demoVideoUrl('/')).toBe(`/${DEMO_VIDEO_PATH}`);
    expect(demoVideoUrl('/app/')).toBe(`/app/${DEMO_VIDEO_PATH}`);
    expect(demoVideoUrl('/app')).toBe(`/app/${DEMO_VIDEO_PATH}`);
    expect(demoVideoUrl('./')).toBe(`./${DEMO_VIDEO_PATH}`);
  });
  it('treats an empty base as the site root', () => {
    expect(demoVideoUrl('')).toBe(`/${DEMO_VIDEO_PATH}`);
  });
  it('never produces a double slash after the base', () => {
    for (const base of ['/', '/x/', '/x', '', './', '/a/b/']) {
      expect(demoVideoUrl(base).replace(/^\.?\//, '')).not.toContain('//');
    }
  });
  it('names the demo as an mp4 file', () => {
    expect(DEMO_VIDEO_PATH.endsWith('.mp4')).toBe(true);
    expect(DEMO_FILE_NAME.endsWith('.mp4')).toBe(true);
  });
});
