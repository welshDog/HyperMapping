import type { Surface } from '../surfaces/types';
import { buildTopology } from '../warp/mesh';
import { distinctVideos } from './face-videos';
import { FrameLoop } from './frame-loop';
import { SurfaceSync } from './surface-sync';
import type { Renderer, RendererOptions } from './types';
import { isVideoReady } from './video-ready';

const VS = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
in vec3 a_frame;
out vec2 v_uv;
out vec3 v_frame;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = a_uv;
  v_frame = a_frame;
}`;

// The shape maths mirrors shapeDistance() in src/warp/shape.ts and the WGSL in webgpu.ts: change all three together.
// v_frame = (frameX, frameY, shape id); quads are id 0 and always fully covered. Coverage turns the signed
// distance into a ~1 pixel anti-aliased edge; the output is premultiplied so it blends over the black clear colour.
const FS = `#version 300 es
precision highp float;
in vec2 v_uv;
in vec3 v_frame;
uniform sampler2D u_tex;
out vec4 o_color;
void main() {
  vec2 p = v_frame.xy;
  int shape = int(v_frame.z + 0.5);
  float circle = length(p - 0.5) - 0.5;
  float inv = 0.8944271909999159; // 1 / sqrt(1.25)
  float tri = max(max((-(p.x - 0.5) - 0.5 * p.y) * inv, ((p.x - 0.5) - 0.5 * p.y) * inv), p.y - 1.0);
  float f = shape == 2 ? circle : (shape == 1 ? tri : -1.0);
  float w = max(length(vec2(dFdx(f), dFdy(f))), 1e-6);
  float cov = shape == 0 ? 1.0 : clamp(0.5 - f / w, 0.0, 1.0);
  o_color = vec4(texture(u_tex, v_uv).rgb * cov, cov);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return s;
}

interface GlSurface {
  vao: WebGLVertexArrayObject;
  posBuf: WebGLBuffer;
  uvBuf: WebGLBuffer;
  frameBuf: WebGLBuffer;
}

export function createWebGL2Renderer(canvas: HTMLCanvasElement, options: RendererOptions = {}): Renderer {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: options.preserveDrawingBuffer ?? false,
  });
  if (!gl) throw new Error('WebGL2 is not available');

  const program = gl.createProgram()!;
  let vs: WebGLShader | null = null;
  let fs: WebGLShader | null = null;
  try {
    vs = compile(gl, gl.VERTEX_SHADER, VS);
    fs = compile(gl, gl.FRAGMENT_SHADER, FS);
  } catch (e) {
    if (vs) gl.deleteShader(vs); // compile() already deleted the one that failed
    gl.deleteProgram(program);
    throw e;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  const linked = gl.getProgramParameter(program, gl.LINK_STATUS);
  const linkLog = linked ? '' : gl.getProgramInfoLog(program);
  // The linked program keeps what it needs; the shader objects are no longer required.
  gl.detachShader(program, vs);
  gl.detachShader(program, fs);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!linked) {
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${linkLog}`);
  }
  gl.useProgram(program);
  // Shape edges blend over the black clear colour (premultiplied output); quads have coverage 1, so they are unchanged.
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  const topo = buildTopology();
  const aPos = gl.getAttribLocation(program, 'a_pos');
  const aUv = gl.getAttribLocation(program, 'a_uv');
  const aFrame = gl.getAttribLocation(program, 'a_frame');
  const surfaceBytes = topo.vertexCount * 2 * 4;
  const frameBytes = topo.vertexCount * 3 * 4;

  // One index buffer shared by every face; each face's VAO captures it.
  const idxBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, topo.indices, gl.STATIC_DRAW);

  const createSurface = (): GlSurface => {
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const posBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, surfaceBytes, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    const uvBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
    gl.bufferData(gl.ARRAY_BUFFER, surfaceBytes, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aUv);
    gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);
    const frameBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, frameBuf);
    gl.bufferData(gl.ARRAY_BUFFER, frameBytes, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(aFrame);
    gl.vertexAttribPointer(aFrame, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bindVertexArray(null);
    return { vao, posBuf, uvBuf, frameBuf };
  };

  const freeSurface = (s: GlSurface) => {
    gl.deleteVertexArray(s.vao);
    gl.deleteBuffer(s.posBuf);
    gl.deleteBuffer(s.uvBuf);
    gl.deleteBuffer(s.frameBuf);
  };

  // One texture per distinct video element, created lazily and freed once no face uses the element.
  const textures = new Map<HTMLVideoElement, WebGLTexture>();
  const textureFor = (v: HTMLVideoElement): WebGLTexture => {
    let t = textures.get(v);
    if (!t) {
      t = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      textures.set(v, t);
    }
    return t;
  };
  gl.uniform1i(gl.getUniformLocation(program, 'u_tex'), 0);
  gl.activeTexture(gl.TEXTURE0); // the only unit used

  const sync = new SurfaceSync();
  const surfaces = new Map<string, GlSurface>();
  let order: string[] = [];
  let destroyed = false;
  // Which video each face shows: one shared video (setVideo) or a per-face map (setFaceVideos); the last call wins.
  let allVideo: HTMLVideoElement | null = null;
  let faceVideos: ReadonlyMap<string, HTMLVideoElement | null> | null = null;
  const pick = (id: string): HTMLVideoElement | null => (faceVideos ? (faceVideos.get(id) ?? null) : allVideo);

  const setSurfaces = (list: Surface[]) => {
    if (destroyed) return;
    const r = sync.sync(list);
    for (const id of r.removed) {
      const s = surfaces.get(id);
      if (s) freeSurface(s);
      surfaces.delete(id);
    }
    for (const id of r.created) surfaces.set(id, createSurface());
    for (const id of r.changedPositions) {
      const g = surfaces.get(id);
      const b = sync.buffers(id);
      if (!g || !b) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, g.posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, b.positions);
    }
    for (const id of r.changedUvs) {
      const g = surfaces.get(id);
      const b = sync.buffers(id);
      if (!g || !b) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, g.uvBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, b.uvs);
    }
    for (const id of r.changedFrames) {
      const g = surfaces.get(id);
      const b = sync.buffers(id);
      if (!g || !b) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, g.frameBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, b.frame);
    }
    order = r.order;
  };

  const warnedVideos = new WeakSet<HTMLVideoElement>();

  const draw = () => {
    if (destroyed) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // Faces that have a mesh, in list order; unready videos stay "used" so their texture survives a brief stall.
    const live = order.filter((id) => surfaces.has(id));
    const used = distinctVideos(live, pick);
    for (const [v, t] of textures) {
      if (!used.includes(v)) {
        gl.deleteTexture(t);
        textures.delete(v);
      }
    }
    const ready = new Set<HTMLVideoElement>();
    for (const v of used) {
      if (!isVideoReady(v)) continue;
      try {
        gl.bindTexture(gl.TEXTURE_2D, textureFor(v));
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, v); // once per frame per distinct video
        ready.add(v);
      } catch (e) {
        // One bad source (for example a tainted video) must not blank the faces on healthy sources.
        if (!warnedVideos.has(v)) {
          warnedVideos.add(v);
          console.warn('[hypermapping] a video could not be uploaded; its faces are skipped', e);
        }
      }
    }
    for (const id of live) {
      const v = pick(id);
      if (!v || !ready.has(v)) continue;
      gl.bindTexture(gl.TEXTURE_2D, textures.get(v)!);
      gl.bindVertexArray(surfaces.get(id)!.vao);
      gl.drawElements(gl.TRIANGLES, topo.indices.length, gl.UNSIGNED_SHORT, 0);
    }
    gl.bindVertexArray(null);
  };

  const loop = new FrameLoop({ draw, onFrameTime: (ms) => renderer.onFrameTime?.(ms) });

  const renderer: Renderer = {
    kind: 'webgl2',
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
      // Deliberately does not lose the context: the canvas may be reused.
      if (destroyed) return;
      destroyed = true;
      loop.stop();
      for (const s of surfaces.values()) freeSurface(s);
      surfaces.clear();
      for (const t of textures.values()) gl.deleteTexture(t);
      textures.clear();
      gl.deleteBuffer(idxBuf);
      gl.deleteProgram(program);
    },
  };
  return renderer;
}
