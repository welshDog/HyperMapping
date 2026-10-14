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
  // Everything that can fail (device, shader, pipeline) happens BEFORE touching
  // the canvas: once getContext('webgpu') has succeeded the canvas can no longer
  // give out a WebGL2 context, so a failure after that point would leave no fallback.
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('No WebGPU adapter');
  const device = await adapter.requestDevice();
  let renderer: Renderer | null = null; // assigned below; device.lost may fire any time after
  device.lost.then((info) => {
    console.warn('[hypermapping] WebGPU device lost:', info.message);
    if (info.reason !== 'destroyed') renderer?.onDeviceLost?.(info.message);
  });

  const format = navigator.gpu.getPreferredCanvasFormat(); // needs no canvas
  const topo = buildTopology();
  const positions = new Float32Array(topo.vertexCount * 2);
  let pipeline: GPURenderPipeline;
  let sampler: GPUSampler;
  let posBuf: GPUBuffer;
  let uvBuf: GPUBuffer;
  let idxBuf: GPUBuffer;
  let ctx: GPUCanvasContext;
  try {
    const module = device.createShaderModule({ code: WGSL });
    const compile = await module.getCompilationInfo();
    const errors = compile.messages.filter((m) => m.type === 'error');
    if (errors.length) throw new Error(`WGSL compile failed: ${errors.map((m) => m.message).join('; ')}`);

    // The async variant rejects on validation errors instead of failing silently later.
    pipeline = await device.createRenderPipelineAsync({
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
    sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    posBuf = device.createBuffer({
      label: 'warp positions',
      size: positions.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    uvBuf = device.createBuffer({
      label: 'warp uvs',
      size: topo.uvs.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    idxBuf = device.createBuffer({
      label: 'warp indices',
      size: topo.indices.byteLength, // 4800 bytes, a multiple of 4
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(uvBuf, 0, topo.uvs as Float32Array<ArrayBuffer>);
    device.queue.writeBuffer(idxBuf, 0, topo.indices as Uint16Array<ArrayBuffer>);

    // Only now claim the canvas.
    const c = canvas.getContext('webgpu');
    if (!c) throw new Error('Could not get a WebGPU canvas context');
    c.configure({ device, format, alphaMode: 'opaque' });
    ctx = c;
  } catch (e) {
    device.destroy(); // free the GPU before falling back to WebGL2
    throw e;
  }

  let dirty = false;
  let destroyed = false;
  let video: HTMLVideoElement | null = null;

  const setCorners = (c: Corners) => {
    if (warpedPositions(c, GRID, GRID, positions)) dirty = true; // invalid quad: keep previous
  };
  setCorners(UNIT_CORNERS);

  const draw = () => {
    if (destroyed) return;
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

  const loop = new FrameLoop({ draw, onFrameTime: (ms) => renderer?.onFrameTime?.(ms) });

  renderer = {
    kind: 'webgpu',
    onFrameTime: null,
    setCorners,
    setVideo: (v) => {
      video = v;
    },
    setFpsCap: (cap) => {
      loop.fpsCap = cap;
    },
    start: () => {
      if (!destroyed) loop.start();
    },
    stop: () => loop.stop(),
    destroy: () => {
      if (destroyed) return;
      destroyed = true; // draw()/start() are no-ops from here on
      loop.stop(); // stop the render loop BEFORE anything is torn down
      try {
        posBuf.destroy();
        uvBuf.destroy();
        idxBuf.destroy();
        ctx.unconfigure();
        device.destroy(); // device.lost then fires with reason 'destroyed' (ignored above)
      } catch (e) {
        console.warn('[hypermapping] WebGPU teardown error:', e);
      }
    },
  };
  return renderer;
}
