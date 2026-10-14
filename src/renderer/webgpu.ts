import { GRID, buildTopology, warpedPositions } from '../warp/mesh';
import { UNIT_CORNERS, type Corners } from '../warp/types';
import { FrameLoop } from './frame-loop';
import type { Renderer } from './types';
import { isVideoReady } from './video-ready';

const WGSL = /* wgsl */ `
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@location(0) p: vec2f, @location(1) uv: vec2f) -> VSOut {
  var o: VSOut;
  o.pos = vec4f(p, 0.0, 1.0);
  o.uv = uv;
  return o;
}

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_external;

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  return textureSampleBaseClampToEdge(tex, samp, in.uv);
}
`;

export async function createWebGPURenderer(canvas: HTMLCanvasElement): Promise<Renderer> {
  if (!navigator.gpu) throw new Error('WebGPU is not available');
  // Acquire the device BEFORE touching the canvas: once getContext('webgpu') has
  // succeeded the canvas can no longer give out a WebGL2 context for the fallback.
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice();
  device.lost.then((info) => console.warn('[hypermapping] WebGPU device lost:', info.message));

  const ctx = canvas.getContext('webgpu');
  if (!ctx) throw new Error('Could not get a WebGPU canvas context');
  const format = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'opaque' });

  const topo = buildTopology();
  const positions = new Float32Array(topo.vertexCount * 2);

  const posBuf = device.createBuffer({
    label: 'warp positions',
    size: positions.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  const uvBuf = device.createBuffer({
    label: 'warp uvs',
    size: topo.uvs.byteLength,
    usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
  });
  const idxBuf = device.createBuffer({
    label: 'warp indices',
    size: topo.indices.byteLength, // 4800 bytes, a multiple of 4
    usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(uvBuf, 0, topo.uvs as Float32Array<ArrayBuffer>);
  device.queue.writeBuffer(idxBuf, 0, topo.indices as Uint16Array<ArrayBuffer>);

  const module = device.createShaderModule({ code: WGSL });
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: {
      module,
      entryPoint: 'vs',
      buffers: [
        { arrayStride: 8, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x2' }] },
        { arrayStride: 8, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x2' }] },
      ],
    },
    fragment: { module, entryPoint: 'fs', targets: [{ format }] },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
  });
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

  let dirty = false;
  let video: HTMLVideoElement | null = null;

  const setCorners = (c: Corners) => {
    if (warpedPositions(c, GRID, GRID, positions)) dirty = true; // invalid quad: keep previous
  };
  setCorners(UNIT_CORNERS);

  const draw = () => {
    if (dirty) {
      device.queue.writeBuffer(posBuf, 0, positions);
      dirty = false;
    }
    const encoder = device.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: ctx.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    if (video && isVideoReady(video)) {
      // External textures are valid for one frame, so the bind group is rebuilt each draw.
      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: sampler },
          { binding: 1, resource: device.importExternalTexture({ source: video }) },
        ],
      });
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, bindGroup);
      pass.setVertexBuffer(0, posBuf);
      pass.setVertexBuffer(1, uvBuf);
      pass.setIndexBuffer(idxBuf, 'uint16');
      pass.drawIndexed(topo.indices.length);
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
  };

  const loop = new FrameLoop({ draw, onFrameTime: (ms) => renderer.onFrameTime?.(ms) });

  const renderer: Renderer = {
    kind: 'webgpu',
    onFrameTime: null,
    setCorners,
    setVideo: (v) => {
      video = v;
    },
    setFpsCap: (cap) => {
      loop.fpsCap = cap;
    },
    start: () => loop.start(),
    stop: () => loop.stop(),
    destroy: () => {
      loop.stop();
      posBuf.destroy();
      uvBuf.destroy();
      idxBuf.destroy();
    },
  };
  return renderer;
}
