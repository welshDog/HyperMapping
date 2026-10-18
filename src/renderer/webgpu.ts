import type { Surface } from '../surfaces/types';
import { buildTopology } from '../warp/mesh';
import { distinctVideos } from './face-videos';
import { FrameLoop } from './frame-loop';
import { SurfaceSync } from './surface-sync';
import type { Renderer } from './types';
import { isVideoReady } from './video-ready';

const WGSL = /* wgsl */ `
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) frame: vec3f,
};

@vertex
fn vs(@location(0) p: vec2f, @location(1) uv: vec2f, @location(2) frame: vec3f) -> VSOut {
  var o: VSOut;
  o.pos = vec4f(p, 0.0, 1.0);
  o.uv = uv;
  o.frame = frame;
  return o;
}

@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var tex: texture_external;

// The shape maths mirrors shapeDistance() in src/warp/shape.ts and the GLSL in webgl2.ts: change all three together.
// frame = (frameX, frameY, shape id); quads are id 0 and always fully covered. Coverage turns the signed distance
// into a ~1 pixel anti-aliased edge; the output is premultiplied so it blends over the black clear colour.
// No branches: derivatives must stay in uniform control flow.
@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let p = in.frame.xy;
  let shape = i32(in.frame.z + 0.5);
  let circle = length(p - vec2f(0.5)) - 0.5;
  let inv = 0.8944271909999159; // 1 / sqrt(1.25)
  let tri = max(max((-(p.x - 0.5) - 0.5 * p.y) * inv, ((p.x - 0.5) - 0.5 * p.y) * inv), p.y - 1.0);
  let f = select(select(-1.0, tri, shape == 1), circle, shape == 2);
  let w = max(length(vec2f(dpdx(f), dpdy(f))), 1e-6);
  let cov = select(clamp(0.5 - f / w, 0.0, 1.0), 1.0, shape == 0);
  let c = textureSampleBaseClampToEdge(tex, samp, in.uv);
  return vec4f(c.rgb * cov, cov);
}
`;

interface GpuSurface {
  posBuf: GPUBuffer;
  uvBuf: GPUBuffer;
  frameBuf: GPUBuffer;
}

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
  const surfaceBytes = topo.vertexCount * 2 * 4;
  const frameBytes = topo.vertexCount * 3 * 4;
  let pipeline: GPURenderPipeline;
  let sampler: GPUSampler;
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
          { arrayStride: 12, attributes: [{ shaderLocation: 2, offset: 0, format: 'float32x3' }] },
        ],
      },
      fragment: {
        module,
        entryPoint: 'fs',
        // Premultiplied output over the black clear colour: shape edges fade out, quads (coverage 1) are unchanged.
        targets: [
          {
            format,
            blend: {
              color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
              alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
            },
          },
        ],
      },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
    });
    sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });

    // One index buffer shared by every face.
    idxBuf = device.createBuffer({
      label: 'warp indices',
      size: topo.indices.byteLength, // 4800 bytes, a multiple of 4
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
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

  const sync = new SurfaceSync();
  const surfaces = new Map<string, GpuSurface>();
  let order: string[] = [];
  let destroyed = false;
  // Which video each face shows: one shared video (setVideo) or a per-face map (setFaceVideos); the last call wins.
  let allVideo: HTMLVideoElement | null = null;
  let faceVideos: ReadonlyMap<string, HTMLVideoElement | null> | null = null;
  const pick = (id: string): HTMLVideoElement | null => (faceVideos ? (faceVideos.get(id) ?? null) : allVideo);

  const createSurface = (id: string): GpuSurface => ({
    posBuf: device.createBuffer({
      label: `face ${id} positions`,
      size: surfaceBytes,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    }),
    uvBuf: device.createBuffer({
      label: `face ${id} uvs`,
      size: surfaceBytes,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    }),
    frameBuf: device.createBuffer({
      label: `face ${id} frame`,
      size: frameBytes,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    }),
  });

  const freeSurface = (s: GpuSurface) => {
    s.posBuf.destroy();
    s.uvBuf.destroy();
    s.frameBuf.destroy();
  };

  const setSurfaces = (list: Surface[]) => {
    if (destroyed) return;
    const r = sync.sync(list);
    for (const id of r.removed) {
      const s = surfaces.get(id);
      if (s) freeSurface(s);
      surfaces.delete(id);
    }
    for (const id of r.created) surfaces.set(id, createSurface(id));
    for (const id of r.changedPositions) {
      const g = surfaces.get(id);
      const b = sync.buffers(id);
      if (g && b) device.queue.writeBuffer(g.posBuf, 0, b.positions);
    }
    for (const id of r.changedUvs) {
      const g = surfaces.get(id);
      const b = sync.buffers(id);
      if (g && b) device.queue.writeBuffer(g.uvBuf, 0, b.uvs);
    }
    for (const id of r.changedFrames) {
      const g = surfaces.get(id);
      const b = sync.buffers(id);
      if (g && b) device.queue.writeBuffer(g.frameBuf, 0, b.frame);
    }
    order = r.order;
  };

  const draw = () => {
    if (destroyed) return;
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
    // External textures are valid for one frame, so bind groups are rebuilt each draw:
    // one import + bind group per distinct READY video, shared by every face that uses it.
    const live = order.filter((id) => surfaces.has(id));
    const groups = new Map<HTMLVideoElement, GPUBindGroup>();
    for (const v of distinctVideos(live, pick)) {
      if (!isVideoReady(v)) continue;
      groups.set(
        v,
        device.createBindGroup({
          layout: pipeline.getBindGroupLayout(0),
          entries: [
            { binding: 0, resource: sampler },
            { binding: 1, resource: device.importExternalTexture({ source: v }) },
          ],
        }),
      );
    }
    if (groups.size > 0) {
      pass.setPipeline(pipeline);
      pass.setIndexBuffer(idxBuf, 'uint16');
      for (const id of live) {
        const v = pick(id);
        const group = v ? groups.get(v) : undefined;
        if (!group) continue;
        const g = surfaces.get(id)!;
        pass.setBindGroup(0, group);
        pass.setVertexBuffer(0, g.posBuf);
        pass.setVertexBuffer(1, g.uvBuf);
        pass.setVertexBuffer(2, g.frameBuf);
        pass.drawIndexed(topo.indices.length);
      }
    }
    pass.end();
    device.queue.submit([encoder.finish()]);
  };

  const loop = new FrameLoop({ draw, onFrameTime: (ms) => renderer?.onFrameTime?.(ms) });

  renderer = {
    kind: 'webgpu',
    onFrameTime: null,
    setSurfaces,
    setVideo: (v) => {
      allVideo = v;
      faceVideos = null;
    },
    setFaceVideos: (m) => {
      faceVideos = new Map(m); // copy: later edits to the caller's map must not leak in
      allVideo = null;
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
      destroyed = true; // draw()/start()/setSurfaces() are no-ops from here on
      loop.stop(); // stop the render loop BEFORE anything is torn down
      try {
        for (const s of surfaces.values()) freeSurface(s);
        surfaces.clear();
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
