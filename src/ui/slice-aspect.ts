import { PATTERN_HEIGHT, PATTERN_WIDTH, wantsPattern } from '../sources/pattern';

export interface SliceAspectInput {
  /** The Test pattern button. */
  force: boolean;
  /** Whether this browser could make the test pattern. */
  patternAvailable: boolean;
  /** The loaded video's size, or null when no video is loaded. */
  video: { width: number; height: number } | null;
}

/**
 * The width / height of the picture the faces are actually showing, which is the shape the slice box
 * must have: the pattern's (16:9) while the pattern is on screen, otherwise the video's, otherwise 16:9.
 */
export function sliceAspect({ force, patternAvailable, video }: SliceAspectInput): number {
  const patternShown = wantsPattern(force, video !== null) && patternAvailable;
  if (patternShown) return PATTERN_WIDTH / PATTERN_HEIGHT;
  if (video && video.width > 0 && video.height > 0) return video.width / video.height;
  return PATTERN_WIDTH / PATTERN_HEIGHT;
}
