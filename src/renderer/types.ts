import type { Surface } from '../surfaces/types';

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
  setVideo(video: HTMLVideoElement | null): void;
  setFpsCap(cap: 30 | 60): void;
  start(): void;
  stop(): void;
  destroy(): void;
}
