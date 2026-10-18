import type { Surface } from '../surfaces/types';

/** Options a caller may pass when creating a renderer. */
export interface RendererOptions {
  /**
   * WebGL2 only (WebGPU ignores it): keep the drawn picture readable after the frame, so another
   * context (e.g. the simulator's three.js view) can sample the canvas at any time.
   */
  preserveDrawingBuffer?: boolean;
}

export interface Renderer {
  readonly kind: 'webgpu' | 'webgl2';
  /** Called with ms between drawn frames; wire to ThermalGuard. */
  onFrameTime: ((ms: number) => void) | null;
  /** WebGPU only: the GPU device was lost (driver reset, OOM). WebGL2 leaves it undefined. */
  onDeviceLost?: (message: string) => void;
  /**
   * The whole face list, in draw order. Each face shows its own slice of the video. A face
   * with an invalid quad keeps its previous mesh and one with an invalid slice keeps its
   * previous UVs; other faces are unaffected. Faces missing from the list are freed.
   */
  setSurfaces(surfaces: Surface[]): void;
  /** Every face shows this one video (null: nothing drawn). Replaces any per-face setting from `setFaceVideos`. */
  setVideo(video: HTMLVideoElement | null): void;
  /**
   * The video each face shows, by face id. A face missing from the map, or mapped to null, draws nothing.
   * Each distinct video element is uploaded once per frame however many faces use it. Replaces `setVideo`'s setting.
   */
  setFaceVideos(videos: ReadonlyMap<string, HTMLVideoElement | null>): void;
  setFpsCap(cap: 30 | 60): void;
  start(): void;
  stop(): void;
  destroy(): void;
}
