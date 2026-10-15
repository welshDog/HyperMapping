export type SourceKind = 'pattern' | 'generator' | 'video' | 'none';

/**
 * Priority: pattern forced (and available) > generator on (and available)
 * > video loaded > pattern fallback > none. Unavailable choices fall through.
 */
export function pickSource(i: {
  patternForce: boolean;
  generatorOn: boolean;
  hasVideo: boolean;
  patternAvailable: boolean;
  generatorAvailable: boolean;
}): SourceKind {
  if (i.patternForce && i.patternAvailable) return 'pattern';
  if (i.generatorOn && i.generatorAvailable) return 'generator';
  if (i.hasVideo) return 'video';
  if (i.patternAvailable) return 'pattern';
  return 'none';
}
