import { PATTERN_HEIGHT, PATTERN_WIDTH } from '../sources/pattern';
import type { FaceSource } from '../surfaces/types';

export interface SliceAspectInput {
  /** What the selected face is set to show. */
  source: FaceSource;
  /** The Test pattern button is on: every face shows the pattern. */
  patternForced: boolean;
  /** The loaded video's width / height, or null when no video is loaded. */
  videoAspect: number | null;
}

/**
 * The width / height of the picture the selected face is actually showing, which is the shape its slice
 * box must have: 16:9 for a look or the test pattern (also when the pattern is forced), the loaded
 * video's shape for a Video face, and 16:9 when there is no usable video.
 */
export function sliceAspect({ source, patternForced, videoAspect }: SliceAspectInput): number {
  const generated = patternForced || source !== 'video';
  if (!generated && videoAspect !== null && Number.isFinite(videoAspect) && videoAspect > 0) return videoAspect;
  return PATTERN_WIDTH / PATTERN_HEIGHT;
}
