export type Backend = 'webgpu' | 'webgl2';

export function chooseBackends(opts: { forced?: string | null; hasWebGPU: boolean }): Backend[] {
  if (opts.forced === 'webgl2') return ['webgl2'];
  if (opts.forced === 'webgpu') return ['webgpu'];
  return opts.hasWebGPU ? ['webgpu', 'webgl2'] : ['webgl2'];
}
