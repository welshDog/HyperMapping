import { chooseBackends } from './backends';
import type { Renderer } from './types';
import { createWebGL2Renderer } from './webgl2';
import { createWebGPURenderer } from './webgpu';

export type { Renderer } from './types';
export { ThermalGuard, type Quality } from './quality';
export { computeBackingSize } from './fit';

/**
 * Pick the best backend. `?renderer=webgl2` or `?renderer=webgpu` in the URL
 * forces exactly one (failures are then visible instead of silently falling back).
 */
export async function createRenderer(
  canvas: HTMLCanvasElement,
  forced: string | null = new URLSearchParams(location.search).get('renderer'),
): Promise<Renderer> {
  const order = chooseBackends({ forced, hasWebGPU: 'gpu' in navigator });
  const errors: string[] = [];
  for (const backend of order) {
    try {
      return backend === 'webgpu' ? await createWebGPURenderer(canvas) : createWebGL2Renderer(canvas);
    } catch (e) {
      console.warn(`[hypermapping] ${backend} failed`, e);
      errors.push(`${backend}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  throw new Error(`No usable graphics backend (${errors.join('; ')})`);
}
