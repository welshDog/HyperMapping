import { createStreamVideo, type StreamVideo } from '../sources/stream-video';
import { FRAGMENT_SRC, lookUniforms, VERTEX_SRC, type LookUniforms } from './shaders';
import { currentLook, type GeneratorState } from './shuffle';

export const GENERATOR_WIDTH = 960;
export const GENERATOR_HEIGHT = 540;
const STREAM_FPS = 30;
const HIDDEN_FRAME_MS = 33;

export interface GeneratorSource {
  /** A live, muted video of the visuals: hand it to `Renderer.setVideo`. */
  video: HTMLVideoElement;
  /** Store the state to draw from the next frame on (no GL work here). */
  setState(state: GeneratorState): void;
  /** Restart the stream if the browser paused it (backgrounded tab). */
  ensurePlaying(): void;
  /** Stop the loop, free the GL objects and the context, drop the video. Safe to call twice. */
  dispose(): void;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('[generator] shader compile failed:', gl.getShaderInfoLog(sh));
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

const LOOK_UNIFORMS = ['u_style', 'u_seed', 'u_speed', 'u_pa', 'u_pb', 'u_pc', 'u_pd'] as const;
type LookUniformName = (typeof LOOK_UNIFORMS)[number];

/**
 * Draw the random visuals with WebGL2 on a hidden 960x540 canvas and expose it as a live video.
 * Returns null (never throws) when the browser cannot do that.
 */
export function createGeneratorSource(): GeneratorSource | null {
  let gl: WebGL2RenderingContext | null = null;
  let vs: WebGLShader | null = null;
  let fs: WebGLShader | null = null;
  let program: WebGLProgram | null = null;
  let vao: WebGLVertexArrayObject | null = null;
  let sv: StreamVideo | null = null;
  let raf: number | null = null;
  let timer: number | null = null;
  let disposed = false;
  let onVisibility: (() => void) | null = null;

  const stopLoop = () => {
    if (raf !== null) cancelAnimationFrame(raf);
    if (timer !== null) window.clearTimeout(timer);
    raf = null;
    timer = null;
  };
  const release = () => {
    disposed = true;
    stopLoop();
    if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
    onVisibility = null;
    try {
      if (gl) {
        if (vao) gl.deleteVertexArray(vao);
        if (program) gl.deleteProgram(program);
        if (vs) gl.deleteShader(vs);
        if (fs) gl.deleteShader(fs);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    } catch {
      // the context may already be lost
    }
    vao = program = vs = fs = null;
    gl = null;
    sv?.dispose();
    sv = null;
  };

  try {
    const canvas = document.createElement('canvas');
    canvas.width = GENERATOR_WIDTH;
    canvas.height = GENERATOR_HEIGHT;
    gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
    if (!gl) return null;

    vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SRC);
    fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
    if (!vs || !fs) {
      release();
      return null;
    }
    program = gl.createProgram();
    if (!program) {
      release();
      return null;
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.warn('[generator] program link failed:', gl.getProgramInfoLog(program));
      release();
      return null;
    }
    vao = gl.createVertexArray();

    const loc = (name: string) => gl!.getUniformLocation(program!, name);
    const uRes = loc('u_res');
    const uTime = loc('u_time');
    const uFade = loc('u_fade');
    const uPulse = loc('u_pulse');
    const uLook = Object.fromEntries(LOOK_UNIFORMS.map((n) => [n, loc(n)])) as Record<
      LookUniformName,
      WebGLUniformLocation | null
    >;

    sv = createStreamVideo(canvas, STREAM_FPS);
    if (!sv) {
      release();
      return null;
    }

    let state: GeneratorState | null = null;

    const setLooks = (g: WebGL2RenderingContext, cur: LookUniforms, prev: LookUniforms) => {
      g.uniform1iv(uLook.u_style, [cur.style, prev.style]);
      g.uniform1fv(uLook.u_seed, [cur.seed, prev.seed]);
      g.uniform1fv(uLook.u_speed, [cur.speed, prev.speed]);
      g.uniform3fv(uLook.u_pa, [...cur.a, ...prev.a]);
      g.uniform3fv(uLook.u_pb, [...cur.b, ...prev.b]);
      g.uniform3fv(uLook.u_pc, [...cur.c, ...prev.c]);
      g.uniform3fv(uLook.u_pd, [...cur.d, ...prev.d]);
    };

    const draw = () => {
      const g = gl;
      if (!g || !state || !state.on || g.isContextLost()) return;
      const now = Date.now();
      const { prev, cur, fade } = currentLook(state, now);
      const curU = lookUniforms(cur);
      const prevU = prev ? lookUniforms(prev) : curU;
      g.viewport(0, 0, GENERATOR_WIDTH, GENERATOR_HEIGHT);
      g.useProgram(program);
      g.bindVertexArray(vao);
      g.uniform2f(uRes, GENERATOR_WIDTH, GENERATOR_HEIGHT);
      g.uniform1f(uTime, Math.max(0, now - state.startedAt) / 1000);
      g.uniform1f(uFade, prev ? fade : 1);
      g.uniform1f(uPulse, 0);
      setLooks(g, curU, prevU);
      g.drawArrays(g.TRIANGLES, 0, 3);
    };

    const schedule = () => {
      if (disposed || raf !== null || timer !== null) return;
      if (document.hidden) {
        timer = window.setTimeout(tick, HIDDEN_FRAME_MS);
      } else {
        raf = requestAnimationFrame(tick);
      }
    };
    function tick() {
      raf = null;
      timer = null;
      if (disposed) return;
      try {
        draw();
      } catch (err) {
        console.warn('[generator] draw failed:', err);
      }
      schedule();
    }
    // rAF stops in a hidden tab; switch loop kind when visibility changes so frames keep flowing.
    onVisibility = () => {
      stopLoop();
      schedule();
    };
    document.addEventListener('visibilitychange', onVisibility);
    schedule();

    const video = sv.video;
    const ensurePlaying = sv.ensurePlaying;
    return {
      video,
      setState: (next) => {
        state = next;
      },
      ensurePlaying: () => {
        if (!disposed) ensurePlaying();
      },
      dispose: release,
    };
  } catch (err) {
    console.warn('[generator] could not start:', err);
    release();
    return null;
  }
}
