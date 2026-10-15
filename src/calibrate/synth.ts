import { applyHomographyChecked, computeHomography, type Mat3 } from '../warp/homography';
import type { Vec2 } from '../warp/types';
import type { GrayFrame } from './decode';
import { STEP_PX, bitValue, frameCount, frameSpec } from './patterns';

export interface SynthOptions {
  /** Projector size in pixels. */
  pw: number;
  ph: number;
  /** Camera size in pixels. */
  camW: number;
  camH: number;
  /** Four projector points and where the camera sees them (same order). */
  projCorners: Vec2[];
  camCorners: Vec2[];
  /** Peak noise in grey levels (uniform, +/-). */
  noise?: number;
  seed?: number;
  /** Lit, dark and unlit (ambient) grey levels. */
  hi?: number;
  lo?: number;
  ambient?: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Render every scan frame as a camera would see it through a known projector-to-camera mapping. */
export function synthScan(o: SynthOptions): { frames: GrayFrame[]; projToCam: Mat3; camToProj: Mat3 } {
  const projToCam = computeHomography(o.projCorners, o.camCorners);
  const camToProj = computeHomography(o.camCorners, o.projCorners);
  if (!projToCam || !camToProj) throw new Error('synthScan: degenerate corners');
  const gw = Math.ceil(o.pw / STEP_PX);
  const gh = Math.ceil(o.ph / STEP_PX);
  const hi = o.hi ?? 210;
  const lo = o.lo ?? 40;
  const ambient = o.ambient ?? 30;
  const noise = o.noise ?? 0;
  const rand = mulberry32(o.seed ?? 1);
  // Which projector cell each camera pixel sees (or -1 for outside the projector image).
  const cellOf = new Int32Array(o.camW * o.camH * 2).fill(-1);
  for (let y = 0; y < o.camH; y++) {
    for (let x = 0; x < o.camW; x++) {
      const q = applyHomographyChecked(camToProj, [x + 0.5, y + 0.5]);
      if (!q || q[0] < 0 || q[1] < 0 || q[0] >= o.pw || q[1] >= o.ph) continue;
      const i = (y * o.camW + x) * 2;
      cellOf[i] = Math.min(gw - 1, Math.floor(q[0] / STEP_PX));
      cellOf[i + 1] = Math.min(gh - 1, Math.floor(q[1] / STEP_PX));
    }
  }
  const frames: GrayFrame[] = [];
  for (let f = 0; f < frameCount(gw, gh); f++) {
    const spec = frameSpec(f, gw, gh);
    const out = new Uint8ClampedArray(o.camW * o.camH);
    for (let p = 0; p < out.length; p++) {
      const cx = cellOf[p * 2];
      const base = cx < 0 ? ambient : bitValue(spec, cx, cellOf[p * 2 + 1]) === 1 ? hi : lo;
      out[p] = Math.round(base + (rand() * 2 - 1) * noise);
    }
    frames.push(out);
  }
  return { frames, projToCam, camToProj };
}
