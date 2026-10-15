import { createStreamVideo, type StreamVideo } from '../sources/stream-video';
import {
  CHEAP_OCTAVES,
  FRAGMENT_SRC,
  FULL_OCTAVES,
  GLOBAL_UNIFORMS,
  LOOK_UNIFORMS,
  lookUniforms,
  VERTEX_SRC,
  type LookUniforms,
  type UniformName,
} from './shaders';
import { currentLook, type GeneratorState } from './shuffle';
import { shaderTime } from './speed';

export const GENERATOR_WIDTH = 960;
export const GENERATOR_HEIGHT = 540;
const STREAM_FPS = 30;
/** Minimum gap between draws: the stream is 30 fps, so 60/120 Hz refreshes skip every other frame. */
const MIN_DRAW_GAP_MS = 30;
const HIDDEN_FRAME_MS = 33;
const WARN_EVERY_MS = 5000;
const MAX_CONSECUTIVE_FAILURES = 30;

export interface GeneratorSource {
  /** A live, muted video of the visuals: hand it to `Renderer.setVideo`. */
  video: HTMLVideoElement;
  /** True when the lighter shader mode is in use (touch devices: phones/tablets). */
  readonly cheap: boolean;
  /** Store the state to draw from the next frame on (no GL work here). */
  setState(state: GeneratorState): void;
  /** Only draw while the generator is on AND active (default true): false when another source is showing. */
  setActive(active: boolean): void;
  /** Restart the stream if the browser paused it (backgrounded tab). */
  ensurePlaying(): void;
  /** Stop the loop, free the GL objects and the context, drop the video. Safe to call twice. */
  dispose(): void;
}

interface GlProgram {
  program: WebGLProgram;
  vs: WebGLShader;
  fs: WebGLShader;
  vao: WebGLVertexArrayObject | null;
  loc: Record<UniformName, WebGLUniformLocation | null>;
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

function deleteProgram(gl: WebGL2RenderingContext, p: Partial<GlProgram>): void {
  if (p.vao) gl.deleteVertexArray(p.vao);
  if (p.program) gl.deleteProgram(p.program);
  if (p.vs) gl.deleteShader(p.vs);
  if (p.fs) gl.deleteShader(p.fs);
}

/** Compile, link and look up every uniform. Returns null (and frees what it made) on failure. */
function buildProgram(gl: WebGL2RenderingContext): GlProgram | null {
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SRC);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
  const program = vs && fs ? gl.createProgram() : null;
  if (!vs || !fs || !program) {
    deleteProgram(gl, { vs: vs ?? undefined, fs: fs ?? undefined, program: program ?? undefined });
    return null;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('[generator] program link failed:', gl.getProgramInfoLog(program));
    deleteProgram(gl, { vs, fs, program });
    return null;
  }
  const vao = gl.createVertexArray();
  const names: readonly UniformName[] = [...GLOBAL_UNIFORMS, ...LOOK_UNIFORMS];
  const loc = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(program, n)])) as GlProgram['loc'];
  return { program, vs, fs, vao, loc };
}

function prefersCheapMode(): boolean {
  try {
    return window.matchMedia?.('(pointer: coarse)').matches === true;
  } catch {
    return false;
  }
}

/**
 * Draw the random visuals with WebGL2 on a hidden 960x540 canvas and expose it as a live video.
 * Returns null (never throws) when the browser cannot do that.
 */
export function createGeneratorSource(): GeneratorSource | null {
  let canvas: HTMLCanvasElement | null = null;
  let gl: WebGL2RenderingContext | null = null;
  let prog: GlProgram | null = null;
  let sv: StreamVideo | null = null;
  let raf: number | null = null;
  let timer: number | null = null;
  let disposed = false;
  let lost = false;
  const listeners: [EventTarget, string, EventListener][] = [];
  const listen = (target: EventTarget, type: string, fn: EventListener) => {
    target.addEventListener(type, fn);
    listeners.push([target, type, fn]);
  };

  const stopLoop = () => {
    if (raf !== null) cancelAnimationFrame(raf);
    if (timer !== null) window.clearTimeout(timer);
    raf = null;
    timer = null;
  };
  const release = () => {
    disposed = true;
    stopLoop();
    for (const [target, type, fn] of listeners) target.removeEventListener(type, fn);
    listeners.length = 0;
    try {
      if (gl) {
        if (prog && !gl.isContextLost()) deleteProgram(gl, prog);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      }
    } catch {
      // the context may already be lost
    }
    prog = null;
    gl = null;
    canvas = null;
    sv?.dispose();
    sv = null;
  };

  try {
    canvas = document.createElement('canvas');
    canvas.width = GENERATOR_WIDTH;
    canvas.height = GENERATOR_HEIGHT;
    gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
    if (!gl) return null;
    prog = buildProgram(gl);
    if (!prog) {
      release();
      return null;
    }
    sv = createStreamVideo(canvas, STREAM_FPS);
    if (!sv) {
      release();
      return null;
    }

    const cheap = prefersCheapMode();
    const octaves = cheap ? CHEAP_OCTAVES : FULL_OCTAVES;
    let state: GeneratorState | null = null;
    let lastDrawAt = -Infinity;
    let failures = 0;
    let lastWarnAt = -Infinity;
    let broken = false; // too many consecutive draw failures: stop for good

    const setLooks = (g: WebGL2RenderingContext, p: GlProgram, cur: LookUniforms, prev: LookUniforms) => {
      g.uniform1iv(p.loc.u_style, [cur.style, prev.style]);
      g.uniform1fv(p.loc.u_seed, [cur.seed, prev.seed]);
      g.uniform1fv(p.loc.u_speed, [cur.speed, prev.speed]);
      g.uniform3fv(p.loc.u_pa, [...cur.a, ...prev.a]);
      g.uniform3fv(p.loc.u_pb, [...cur.b, ...prev.b]);
      g.uniform3fv(p.loc.u_pc, [...cur.c, ...prev.c]);
      g.uniform3fv(p.loc.u_pd, [...cur.d, ...prev.d]);
    };

    const draw = (s: GeneratorState) => {
      const g = gl;
      const p = prog;
      if (!g || !p || lost || g.isContextLost()) return;
      const now = Date.now();
      const { prev, cur, fade } = currentLook(s, now);
      const curU = lookUniforms(cur);
      const prevU = prev ? lookUniforms(prev) : curU;
      g.viewport(0, 0, GENERATOR_WIDTH, GENERATOR_HEIGHT);
      g.useProgram(p.program);
      g.bindVertexArray(p.vao);
      g.uniform2f(p.loc.u_res, GENERATOR_WIDTH, GENERATOR_HEIGHT);
      g.uniform1f(p.loc.u_time, shaderTime(s, now));
      g.uniform1f(p.loc.u_fade, prev ? fade : 1);
      g.uniform1f(p.loc.u_pulse, 0);
      g.uniform1i(p.loc.u_octaves, octaves);
      setLooks(g, p, curU, prevU);
      g.drawArrays(g.TRIANGLES, 0, 3);
    };

    let active = true;
    const wantsFrames = () => !disposed && !broken && state !== null && state.on && active;

    /** Draw one frame right now so the stream has a picture before the loop's first tick. */
    const drawNow = () => {
      const s = state;
      if (!s || disposed || broken || lost || !gl || gl.isContextLost()) return;
      try {
        lastDrawAt = performance.now();
        draw(s);
      } catch (err) {
        console.warn('[generator] first frame failed:', err);
      }
    };

    /** Schedule one frame if the generator is on. Never schedules a second pending frame. */
    const schedule = () => {
      if (!wantsFrames() || raf !== null || timer !== null) return;
      if (document.hidden) {
        timer = window.setTimeout(tick, HIDDEN_FRAME_MS);
      } else {
        raf = requestAnimationFrame(tick);
      }
    };
    function tick() {
      raf = null;
      timer = null;
      const s = state;
      if (!wantsFrames() || !s) return; // idle until setState turns it on again
      const t = performance.now();
      if (t - lastDrawAt >= MIN_DRAW_GAP_MS) {
        lastDrawAt = t;
        try {
          draw(s);
          failures = 0;
        } catch (err) {
          failures += 1;
          if (t - lastWarnAt >= WARN_EVERY_MS) {
            lastWarnAt = t;
            console.warn(`[generator] draw failed (${failures} in a row):`, err);
          }
          if (failures >= MAX_CONSECUTIVE_FAILURES) {
            broken = true;
            console.warn('[generator] too many draw failures, stopping the generator loop');
          }
        }
      }
      schedule();
    }

    // rAF stops in a hidden tab; switch loop kind when visibility changes so frames keep flowing.
    listen(document, 'visibilitychange', () => {
      stopLoop();
      schedule();
    });
    // Context loss: keep the last frame, skip drawing, rebuild everything on restore.
    listen(canvas, 'webglcontextlost', (e) => {
      e.preventDefault();
      lost = true;
      prog = null; // its objects died with the context
    });
    listen(canvas, 'webglcontextrestored', () => {
      if (disposed || !gl) return;
      prog = buildProgram(gl);
      lost = prog === null;
      if (lost) console.warn('[generator] could not rebuild after context restore');
    });

    const video = sv.video;
    const ensurePlaying = sv.ensurePlaying;
    return {
      video,
      cheap,
      setState: (next) => {
        const was = wantsFrames();
        state = next;
        if (!was && wantsFrames()) drawNow(); // off -> on: no black first frame
        schedule();
      },
      setActive: (next) => {
        const was = wantsFrames();
        active = next;
        if (!was && wantsFrames()) drawNow();
        if (wantsFrames()) schedule();
        else stopLoop();
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
