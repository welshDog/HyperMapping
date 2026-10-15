import { pickSource } from '../generator/select';
import { PATTERN_HEIGHT, PATTERN_WIDTH } from '../sources/pattern';

export interface SliceAspectInput {
  /** The Test pattern button. */
  force: boolean;
  /** Whether this browser could make the test pattern. */
  patternAvailable: boolean;
  /** The loaded video's size, or null when no video is loaded. */
  video: { width: number; height: number } | null;
  /** The random-visuals generator is switched on. Default false. */
  generatorOn?: boolean;
  /** Whether this browser could make the generator. Default false. */
  generatorAvailable?: boolean;
}

/**
 * The width / height of the picture the faces are actually showing, which is the shape the slice box
 * must have: 16:9 while the test pattern or the generator is on screen, otherwise the video's,
 * otherwise 16:9. The choice goes through `pickSource`, the same rule the renderer feed uses.
 */
export function sliceAspect({
  force,
  patternAvailable,
  video,
  generatorOn = false,
  generatorAvailable = false,
}: SliceAspectInput): number {
  const showing = pickSource({
    patternForce: force,
    generatorOn,
    hasVideo: video !== null,
    patternAvailable,
    generatorAvailable,
  });
  if (showing === 'pattern' || showing === 'generator') return PATTERN_WIDTH / PATTERN_HEIGHT;
  if (showing === 'video' && video && video.width > 0 && video.height > 0) return video.width / video.height;
  return PATTERN_WIDTH / PATTERN_HEIGHT;
}
