import { isValidLook, LOOK_STYLES, randomLook, type Look, type StylePick } from './look';

export const FADE_MS = 1500;
export const SHUFFLE_CHOICES = [0, 15, 30, 60] as const;

export interface GeneratorState {
  on: boolean;
  look: Look;
  prev: Look | null;
  changedAt: number;
  shuffleSec: 0 | 15 | 30 | 60;
  startedAt: number;
  stylePick: StylePick;
}

/** Smoothstep 0..1 over `ms` since `changedAt`; clamped on both ends. */
export function fadeAmount(now: number, changedAt: number, ms: number = FADE_MS): number {
  const t = Math.min(1, Math.max(0, (now - changedAt) / ms));
  return t * t * (3 - 2 * t);
}

export function currentLook(
  state: GeneratorState,
  now: number,
): { prev: Look | null; cur: Look; fade: number } {
  const done = now - state.changedAt >= FADE_MS;
  if (state.prev === null || done) return { prev: null, cur: state.look, fade: 1 };
  return { prev: state.prev, cur: state.look, fade: fadeAmount(now, state.changedAt) };
}

export function randomizeState(state: GeneratorState, now: number, rng: () => number): GeneratorState {
  let next = randomLook(rng, state.stylePick);
  for (let i = 0; i < 8 && next.style === state.look.style && next.seed === state.look.seed; i++) {
    next = randomLook(rng, state.stylePick);
  }
  if (next.style === state.look.style && next.seed === state.look.seed) {
    // Degenerate rng: guarantee a change deterministically.
    next = { style: next.style, seed: (next.seed + 1) >>> 0 };
  }
  return { ...state, prev: state.look, look: next, changedAt: now };
}

export function shuffleDue(state: GeneratorState, now: number): boolean {
  if (!state.on || state.shuffleSec === 0) return false;
  return now - state.changedAt >= state.shuffleSec * 1000;
}

export function initialState(now: number, rng: () => number): GeneratorState {
  return {
    on: false,
    look: randomLook(rng, 'auto'),
    prev: null,
    changedAt: now,
    shuffleSec: 0,
    startedAt: now,
    stylePick: 'auto',
  };
}

export function isValidState(x: unknown): x is GeneratorState {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.on === 'boolean' &&
    isValidLook(o.look) &&
    (o.prev === null || isValidLook(o.prev)) &&
    typeof o.changedAt === 'number' && Number.isFinite(o.changedAt) &&
    typeof o.startedAt === 'number' && Number.isFinite(o.startedAt) &&
    typeof o.shuffleSec === 'number' && (SHUFFLE_CHOICES as readonly number[]).includes(o.shuffleSec) &&
    typeof o.stylePick === 'string' && (o.stylePick === 'auto' || (LOOK_STYLES as readonly string[]).includes(o.stylePick))
  );
}
