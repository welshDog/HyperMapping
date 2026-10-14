import { describe, it, expect } from 'vitest';
import { ASPECT_PRESETS, DEFAULT_PROJECTOR } from './defaults';

describe('ASPECT_PRESETS', () => {
  it('has only finite, positive values', () => {
    expect(ASPECT_PRESETS.length).toBeGreaterThan(0);
    for (const p of ASPECT_PRESETS) {
      expect(Number.isFinite(p.value)).toBe(true);
      expect(p.value).toBeGreaterThan(0);
    }
  });
  it('the default projector uses the 16:9 preset', () => {
    const p = ASPECT_PRESETS.find((a) => a.label === '16:9');
    expect(p).toBeDefined();
    expect(DEFAULT_PROJECTOR.aspect).toBe(p!.value);
  });
});
