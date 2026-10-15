import { describe, expect, it } from 'vitest';
import { pickSource, type SourceKind } from './select';

type In = Parameters<typeof pickSource>[0];

// The written rule, independent of the implementation:
// pattern forced and available -> pattern; else generator on and available -> generator;
// else video loaded -> video; else pattern available -> pattern; else none.
function rule(i: In): SourceKind {
  if (i.patternForce && i.patternAvailable) return 'pattern';
  if (i.generatorOn && i.generatorAvailable) return 'generator';
  if (i.hasVideo) return 'video';
  if (i.patternAvailable) return 'pattern';
  return 'none';
}

describe('pickSource', () => {
  it('matches the written rule over all 32 input combinations', () => {
    let n = 0;
    for (let m = 0; m < 32; m++) {
      const i: In = {
        patternForce: !!(m & 1), generatorOn: !!(m & 2), hasVideo: !!(m & 4),
        patternAvailable: !!(m & 8), generatorAvailable: !!(m & 16),
      };
      expect(pickSource(i), JSON.stringify(i)).toBe(rule(i));
      n++;
    }
    expect(n).toBe(32);
  });
  it('forced-but-unavailable pattern falls through', () => {
    const i: In = { patternForce: true, patternAvailable: false, generatorOn: true, generatorAvailable: true, hasVideo: true };
    expect(pickSource(i)).toBe('generator');
    expect(pickSource({ ...i, generatorOn: false })).toBe('video');
    expect(pickSource({ ...i, generatorOn: false, hasVideo: false })).toBe('none');
  });
  it('generator on but unavailable falls through', () => {
    const i: In = { patternForce: false, patternAvailable: true, generatorOn: true, generatorAvailable: false, hasVideo: true };
    expect(pickSource(i)).toBe('video');
    expect(pickSource({ ...i, hasVideo: false })).toBe('pattern');
  });
  it('spot checks', () => {
    expect(pickSource({ patternForce: true, patternAvailable: true, generatorOn: true, generatorAvailable: true, hasVideo: true })).toBe('pattern');
    expect(pickSource({ patternForce: false, patternAvailable: false, generatorOn: false, generatorAvailable: false, hasVideo: false })).toBe('none');
  });
});
