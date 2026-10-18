import { isValidLook, LOOK_STYLES, randomLook, type Look, type StylePick } from './look';
import { SHUFFLE_CHOICES, type GeneratorState } from './shuffle';
import { SPEED_MAX, SPEED_MIN } from './speed';

/** The saved, per-face part of a visual look (no clocks, no on/off). */
export interface LookSettings {
  look: Look;
  speed: number;
  shuffleSec: 0 | 15 | 30 | 60;
  stylePick: StylePick;
}

export const DEFAULT_LOOK_SETTINGS: LookSettings = {
  look: { style: 'plasma', seed: 1 },
  speed: 1,
  shuffleSec: 0,
  stylePick: 'auto',
};

export function isValidLookSettings(x: unknown): x is LookSettings {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  return (
    isValidLook(o.look) &&
    typeof o.speed === 'number' && Number.isFinite(o.speed) && o.speed >= SPEED_MIN && o.speed <= SPEED_MAX &&
    typeof o.shuffleSec === 'number' && (SHUFFLE_CHOICES as readonly number[]).includes(o.shuffleSec) &&
    typeof o.stylePick === 'string' && (o.stylePick === 'auto' || (LOOK_STYLES as readonly string[]).includes(o.stylePick))
  );
}

/** Rebuilds from validated fields only, so unknown keys never survive. */
export function parseLookSettings(raw: unknown): LookSettings | null {
  if (!isValidLookSettings(raw)) return null;
  return {
    look: { style: raw.look.style, seed: raw.look.seed },
    speed: raw.speed,
    shuffleSec: raw.shuffleSec,
    stylePick: raw.stylePick,
  };
}

/** A fresh random look; speed, shuffle and style pick follow `base` when given. */
export function newLookSettings(rng: () => number, base: LookSettings = DEFAULT_LOOK_SETTINGS): LookSettings {
  let look = randomLook(rng, base.stylePick);
  for (let i = 0; i < 8 && look.style === base.look.style && look.seed === base.look.seed; i++) {
    look = randomLook(rng, base.stylePick);
  }
  return { look, speed: base.speed, shuffleSec: base.shuffleSec, stylePick: base.stylePick };
}

export function stateFromSettings(s: LookSettings, now: number): GeneratorState {
  return {
    on: true,
    look: { style: s.look.style, seed: s.look.seed },
    prev: null,
    changedAt: now,
    shuffleSec: s.shuffleSec,
    startedAt: now,
    stylePick: s.stylePick,
    speed: s.speed,
    timeAnchor: 0,
    speedChangedAt: now,
  };
}

export function settingsFromState(state: GeneratorState): LookSettings {
  return {
    look: { style: state.look.style, seed: state.look.seed },
    speed: state.speed,
    shuffleSec: state.shuffleSec,
    stylePick: state.stylePick,
  };
}

export function sameSettings(a: LookSettings, b: LookSettings): boolean {
  return (
    a.look.style === b.look.style &&
    a.look.seed === b.look.seed &&
    a.speed === b.speed &&
    a.shuffleSec === b.shuffleSec &&
    a.stylePick === b.stylePick
  );
}
