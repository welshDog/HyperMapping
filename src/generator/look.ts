import { mulberry32, randomSeed32 } from './random';

export const LOOK_STYLES = ['plasma', 'kaleidoscope', 'neon', 'particles'] as const;
export type LookStyle = (typeof LOOK_STYLES)[number];
export type StylePick = 'auto' | LookStyle;

/** A look is only a style and a seed; palette and speed derive from the seed. */
export interface Look {
  style: LookStyle;
  seed: number; // integer 0..2^32-1
}

type Vec3 = [number, number, number];
/** Inigo Quilez cosine palette: color(t) = a + b * cos(2*pi*(c*t + d)). */
export interface Palette { a: Vec3; b: Vec3; c: Vec3; d: Vec3 }

/** Salt so the palette stream differs from a stream seeded with the raw seed. */
const SEED_SALT = 0x9e3779b9;
const MAX_COMPONENT = 1.5;

function derivedRng(seed: number): () => number {
  return mulberry32((seed ^ SEED_SALT) >>> 0);
}

export function paletteFor(seed: number): Palette {
  const r = derivedRng(seed);
  const triple = (lo: number, span: number): Vec3 =>
    [0, 1, 2].map(() => Math.min(MAX_COMPONENT, lo + span * r())) as Vec3;
  // Draw order is fixed (a, b, c, d) so speedFor can skip exactly 12 draws.
  const a = triple(0.35, 0.3);
  const b = triple(0.3, 0.25);
  const c = triple(0.6, 1.0);
  const d = triple(0, 1);
  return { a, b, c, d };
}

export function speedFor(seed: number): number {
  const r = derivedRng(seed);
  for (let i = 0; i < 12; i++) r(); // skip the palette draws
  return 0.5 + 0.9 * r();
}

export function randomLook(rng: () => number, pick: StylePick): Look {
  // Always consume the style draw so the stream does not depend on `pick`.
  const drawn = LOOK_STYLES[Math.min(LOOK_STYLES.length - 1, Math.floor(rng() * LOOK_STYLES.length))];
  const style: LookStyle = pick === 'auto' ? drawn : pick;
  return { style, seed: randomSeed32(rng) };
}

export function isValidLook(x: unknown): x is Look {
  if (typeof x !== 'object' || x === null || Array.isArray(x)) return false;
  const o = x as Record<string, unknown>;
  return (
    typeof o.style === 'string' &&
    (LOOK_STYLES as readonly string[]).includes(o.style) &&
    typeof o.seed === 'number' &&
    Number.isInteger(o.seed) &&
    o.seed >= 0 &&
    o.seed < 4294967296
  );
}

const LETTER: Record<LookStyle, string> = { plasma: 'P', kaleidoscope: 'K', neon: 'N', particles: 'S' };
const FROM_LETTER: Record<string, LookStyle> = { P: 'plasma', K: 'kaleidoscope', N: 'neon', S: 'particles' };

/**
 * Weighted check digit: sum of nibble[i] * w[i] over the 8 seed digits, mod 16, with odd weights
 * 1,3,5,...,15. Odd weights are invertible mod 16, so every single-digit change is caught, and an
 * adjacent swap is caught unless the two digits differ by exactly 8.
 */
function checkDigit(hex8: string): string {
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += parseInt(hex8[i], 16) * (2 * i + 1);
  return (sum % 16).toString(16).toUpperCase();
}

/** e.g. 'K-7F3A92C1D': letter, dash, 8 hex seed digits, 1 check digit. */
export function lookToCode(look: Look): string {
  const hex = (look.seed >>> 0).toString(16).toUpperCase().padStart(8, '0');
  return `${LETTER[look.style]}-${hex}${checkDigit(hex)}`;
}

export function lookFromCode(text: string): Look | null {
  if (typeof text !== 'string') return null;
  const m = /^([PKNS])-?([0-9A-F]{8})([0-9A-F])$/.exec(text.trim().toUpperCase());
  if (!m) return null;
  if (checkDigit(m[2]) !== m[3]) return null;
  return { style: FROM_LETTER[m[1]], seed: parseInt(m[2], 16) };
}
