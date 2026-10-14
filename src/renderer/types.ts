import type { Corners } from '../warp/types';

export interface Renderer {
  readonly kind: 'webgpu' | 'webgl2';
  /** Called with ms between drawn frames; wire to ThermalGuard. */
  onFrameTime: ((ms: number) => void) | null;
  /** Corners in unit space (0..1, Y down). Invalid quads are ignored. */
  setCorners(corners: Corners): void;
  setVideo(video: HTMLVideoElement | null): void;
  setFpsCap(cap: 30 | 60): void;
  start(): void;
  stop(): void;
  destroy(): void;
}
