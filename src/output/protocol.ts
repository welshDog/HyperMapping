import { parseFrameSpec, type FrameSpec } from '../calibrate/patterns';
import { isValidState, type GeneratorState } from '../generator/shuffle';
import { parseSurfaceList } from '../surfaces/parse';
import type { Surface } from '../surfaces/types';

export const CHANNEL = 'hypermapping';

export type Msg =
  | { type: 'hello' } // output window -> editor: "send me everything you have"
  | { type: 'surfaces'; surfaces: Surface[] } // editor -> output: the whole face list
  | { type: 'layout'; surfaces: Surface[] } // simulator -> editor: "use this face layout"
  | { type: 'pattern'; on: boolean } // editor -> others: show the test pattern even when a video is loaded
  | { type: 'generator'; state: GeneratorState } // editor -> output: random-visuals generator state
  | { type: 'video'; blob: Blob } // editor -> output (structured-clone copy)
  | { type: 'probe' } // editor -> output: "tell me your size"
  | { type: 'output-size'; w: number; h: number; fullscreen: boolean } // output -> editor
  | { type: 'scan-frame'; spec: FrameSpec | null; gw: number; gh: number; pw: number; ph: number }; // editor -> output: calibration frame, or null to go back

const isDim = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 16384;

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
    case 'generator': {
      const s = d.state;
      if (!isValidState(s)) return null;
      const state: GeneratorState = {
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
      return { type: 'generator', state };
    }
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
