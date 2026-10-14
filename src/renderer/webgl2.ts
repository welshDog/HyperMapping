import { GRID, buildTopology, warpedPositions } from '../warp/mesh';
import { UNIT_CORNERS, type Corners } from '../warp/types';
import { FrameLoop } from './frame-loop';
import type { Renderer } from './types';
import { isVideoReady } from './video-ready';

const VS = `#version 300 es
in vec2 a_pos;
in vec2 a_uv;
out vec2 v_uv;
void main() {
  gl_Position = vec4(a_pos, 0.0, 1.0);
  v_uv = a_uv;
}`;

const FS = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 o_color;
void main() {
  o_color = texture(u_tex, v_uv);
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

export function createWebGL2Renderer(canvas: HTMLCanvasElement): Renderer {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
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

  const topo = buildTopology();
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);

  const posBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
  gl.bufferData(gl.ARRAY_BUFFER, topo.vertexCount * 2 * 4, gl.DYNAMIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'a_pos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const uvBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf);
  gl.bufferData(gl.ARRAY_BUFFER, topo.uvs, gl.STATIC_DRAW);
  const aUv = gl.getAttribLocation(program, 'a_uv');
  gl.enableVertexAttribArray(aUv);
  gl.vertexAttribPointer(aUv, 2, gl.FLOAT, false, 0, 0);

  const idxBuf = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, topo.indices, gl.STATIC_DRAW);

  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.uniform1i(gl.getUniformLocation(program, 'u_tex'), 0);

  const positions = new Float32Array(topo.vertexCount * 2);
  let dirty = false;
  let destroyed = false;
  let video: HTMLVideoElement | null = null;

  const setCorners = (c: Corners) => {
    if (warpedPositions(c, GRID, GRID, positions)) dirty = true; // invalid quad: keep previous
  };
  setCorners(UNIT_CORNERS);

  const draw = () => {
    if (destroyed) return;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindVertexArray(vao);
    if (dirty) {
      gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, positions);
      dirty = false;
    }
    if (!video || !isVideoReady(video)) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.drawElements(gl.TRIANGLES, topo.indices.length, gl.UNSIGNED_SHORT, 0);
  };

  const loop = new FrameLoop({ draw, onFrameTime: (ms) => renderer.onFrameTime?.(ms) });

  const renderer: Renderer = {
    kind: 'webgl2',
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
      // Deliberately does not lose the context: the canvas may be reused.
      if (destroyed) return;
      destroyed = true;
      loop.stop();
      gl.deleteTexture(tex);
      gl.deleteBuffer(posBuf);
      gl.deleteBuffer(uvBuf);
      gl.deleteBuffer(idxBuf);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    },
  };
  return renderer;
}
