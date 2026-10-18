import { parseFrameSpec, type FrameSpec } from '../calibrate/patterns';
import { isValidState, type GeneratorState } from '../generator/shuffle';
import { MAX_LOOKS } from '../surfaces/sources';
import { parseSurfaceList } from '../surfaces/parse';
import type { Surface } from '../surfaces/types';

export const CHANNEL = 'hypermapping';

export type Msg =
  | { type: 'hello' } // output window -> editor: "send me everything you have"
  | { type: 'surfaces'; surfaces: Surface[] } // editor -> output: the whole face list
  | { type: 'layout'; surfaces: Surface[] } // simulator -> editor: "use this face layout"
  | { type: 'pattern'; on: boolean } // editor -> others: show the test pattern even when a video is loaded
  | { type: 'looks'; states: Record<string, GeneratorState> } // editor -> output: state of each live look, by owner face id
  | { type: 'audio'; bass: number; treble: number; vol: number } // editor -> output: live sound levels, each 0..1
  | { type: 'video'; blob: Blob } // editor -> output (structured-clone copy)
  | { type: 'probe' } // editor -> output: "tell me your size"
  | { type: 'output-size'; w: number; h: number; fullscreen: boolean } // output -> editor
  | { type: 'scan-frame'; spec: FrameSpec | null; gw: number; gh: number; pw: number; ph: number }; // editor -> output: calibration frame, or null to go back

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

const isDim = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 16384;

/** Rebuild a validated state from its known fields only, so unknown keys never survive. */
function rebuildState(s: GeneratorState): GeneratorState {
  return {
    on: s.on,
    look: { style: s.look.style, seed: s.look.seed },
    prev: s.prev === null ? null : { style: s.prev.style, seed: s.prev.seed },
    changedAt: s.changedAt,
    shuffleSec: s.shuffleSec,
    startedAt: s.startedAt,
    stylePick: s.stylePick,
    speed: s.speed,
    timeAnchor: s.timeAnchor,
    speedChangedAt: s.speedChangedAt,
  };
}

/** Validate anything that arrives on the channel; never trust the wire. */
export function parseMsg(data: unknown): Msg | null {
  if (typeof data !== 'object' || data === null) return null;
  const d = data as Record<string, unknown>;
  switch (d.type) {
    case 'hello':
      return { type: 'hello' };
    case 'surfaces':
    case 'layout': {
      const surfaces = parseSurfaceList(d.surfaces);
      return surfaces ? { type: d.type, surfaces } : null;
    }
    case 'pattern':
      return typeof d.on === 'boolean' ? { type: 'pattern', on: d.on } : null;
    case 'looks': {
      const raw = d.states;
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
      const entries = Object.entries(raw as Record<string, unknown>);
      if (entries.length > MAX_LOOKS) return null;
      const states: Record<string, GeneratorState> = {};
      for (const [owner, value] of entries) {
        if (owner.length < 1 || owner.length > 32 || !isValidState(value)) return null;
        states[owner] = rebuildState(value);
      }
      return { type: 'looks', states };
    }
    case 'audio':
      return isNum(d.bass) && isNum(d.treble) && isNum(d.vol)
        ? { type: 'audio', bass: clamp01(d.bass), treble: clamp01(d.treble), vol: clamp01(d.vol) }
        : null;
    case 'video':
      return d.blob instanceof Blob ? { type: 'video', blob: d.blob } : null;
    case 'probe':
      return { type: 'probe' };
    case 'output-size':
      return isDim(d.w) && isDim(d.h) && typeof d.fullscreen === 'boolean'
        ? { type: 'output-size', w: d.w, h: d.h, fullscreen: d.fullscreen }
        : null;
    case 'scan-frame': {
      if (!isDim(d.gw) || !isDim(d.gh) || !isDim(d.pw) || !isDim(d.ph)) return null;
      if (d.spec === null) return { type: 'scan-frame', spec: null, gw: d.gw, gh: d.gh, pw: d.pw, ph: d.ph };
      const spec = parseFrameSpec(d.spec);
      return spec ? { type: 'scan-frame', spec, gw: d.gw, gh: d.gh, pw: d.pw, ph: d.ph } : null;
    }
    default:
      return null;
  }
}
