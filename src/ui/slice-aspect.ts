import { PATTERN_HEIGHT, PATTERN_WIDTH } from '../sources/pattern';

export interface SliceAspectInput {
  /** The test pattern is what the face shows (the Test pattern button, or the face's own source). */
  force: boolean;
  /** Whether this browser could make the test pattern. */
  patternAvailable: boolean;
  /** The loaded video's size, or null when no video is loaded. */
  video: { width: number; height: number } | null;
  /** The face is on a visual look. Default false. */
  generatorOn?: boolean;
  /** Whether that look has a live generator. Default false. */
  generatorAvailable?: boolean;
}

/**
 * The width / height of the picture the faces are actually showing, which is the shape the slice box
 * must have: 16:9 while the test pattern or the generator is on screen, otherwise the video's,
 * otherwise 16:9. Priority: pattern (if available) > look (if available) > video > pattern fallback.
 */
export function sliceAspect({
  force,
  patternAvailable,
  video,
  generatorOn = false,
  generatorAvailable = false,
}: SliceAspectInput): number {
  const generated = (force && patternAvailable) || (generatorOn && generatorAvailable);
  if (!generated && video && video.width > 0 && video.height > 0) return video.width / video.height;
  return PATTERN_WIDTH / PATTERN_HEIGHT;
}
