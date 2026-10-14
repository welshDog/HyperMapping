import { describe, it, expect } from 'vitest';
import { chooseBackends } from './backends';

describe('chooseBackends', () => {
  it('prefers WebGPU then WebGL2 when WebGPU exists', () => {
    expect(chooseBackends({ hasWebGPU: true })).toEqual(['webgpu', 'webgl2']);
  });
  it('uses only WebGL2 when WebGPU is missing', () => {
    expect(chooseBackends({ hasWebGPU: false })).toEqual(['webgl2']);
  });
  it('honours a forced backend exclusively so failures are visible', () => {
    expect(chooseBackends({ forced: 'webgl2', hasWebGPU: true })).toEqual(['webgl2']);
    expect(chooseBackends({ forced: 'webgpu', hasWebGPU: false })).toEqual(['webgpu']);
  });
  it('ignores an unknown forced value', () => {
    expect(chooseBackends({ forced: 'banana', hasWebGPU: true })).toEqual(['webgpu', 'webgl2']);
  });
});
