import { describe, expect, it } from 'vitest';
import {
  LOOK_STYLES, isValidLook, lookFromCode, lookToCode, paletteFor, randomLook, speedFor,
  type Look,
} from './look';
import { mulberry32, randomSeed32 } from './random';

const SEEDS = [0, 4294967295, ...Array.from({ length: 1998 }, (_, i) => (i * 2147483 + 12345) >>> 0)];

describe('paletteFor / speedFor', () => {
  it('are deterministic', () => {
    for (const s of SEEDS) {
      expect(paletteFor(s)).toEqual(paletteFor(s));
      expect(speedFor(s)).toBe(speedFor(s));
    }
  });
  it('stay in range for 2000 seeds incl. 0 and 2^32-1', () => {
    expect(SEEDS.length).toBe(2000);
    for (const s of SEEDS) {
      const p = paletteFor(s);
      for (const k of ['a', 'b', 'c', 'd'] as const) {
        expect(p[k]).toHaveLength(3);
        for (const v of p[k]) {
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1.5);
        }
      }
      const sp = speedFor(s);
      expect(sp).toBeGreaterThanOrEqual(0.5);
      expect(sp).toBeLessThanOrEqual(1.4);
    }
  });
  it('different seeds give different palettes', () => {
    expect(paletteFor(1)).not.toEqual(paletteFor(2));
  });
});

describe('randomLook', () => {
  it('auto produces all four styles over 400 draws', () => {
    const r = mulberry32(5);
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(randomLook(r, 'auto').style);
    expect([...seen].sort()).toEqual([...LOOK_STYLES].sort());
  });
  it('a fixed pick is always honoured', () => {
    const r = mulberry32(6);
    for (let i = 0; i < 200; i++) expect(randomLook(r, 'neon').style).toBe('neon');
  });
  it('produces valid looks', () => {
    const r = mulberry32(8);
    for (let i = 0; i < 200; i++) expect(isValidLook(randomLook(r, 'auto'))).toBe(true);
  });
});

describe('isValidLook', () => {
  it('accepts good looks', () => {
    expect(isValidLook({ style: 'plasma', seed: 0 })).toBe(true);
    expect(isValidLook({ style: 'particles', seed: 4294967295 })).toBe(true);
  });
  it('rejects non-objects', () => {
    for (const x of [null, undefined, 5, 'plasma', [], true]) expect(isValidLook(x)).toBe(false);
  });
  it('rejects unknown style', () => {
    expect(isValidLook({ style: 'fire', seed: 1 })).toBe(false);
    expect(isValidLook({ seed: 1 })).toBe(false);
  });
  it('rejects bad seeds', () => {
    for (const seed of [1.5, -1, 4294967296, NaN, Infinity, '5', null, undefined]) {
      expect(isValidLook({ style: 'neon', seed })).toBe(false);
    }
  });
});

describe('codes', () => {
  it('round-trips 1000 random looks', () => {
    const r = mulberry32(11);
    for (let i = 0; i < 1000; i++) {
      const look = randomLook(r, 'auto');
      const code = lookToCode(look);
      expect(code).toMatch(/^[PKNS]-[0-9A-F]{9}$/);
      expect(lookFromCode(code)).toEqual(look);
    }
  });
  it('round-trips edge seeds 0 and 4294967295', () => {
    for (const style of LOOK_STYLES) {
      for (const seed of [0, 4294967295]) {
        const look: Look = { style, seed };
        expect(lookFromCode(lookToCode(look))).toEqual(look);
      }
    }
    expect(lookToCode({ style: 'plasma', seed: 0 })).toBe('P-000000000');
    expect(lookToCode({ style: 'kaleidoscope', seed: 0x7f3a92c1 })).toBe('K-7F3A92C1B');
  });
  it('accepts lowercase, spaces around and a missing dash', () => {
    const look: Look = { style: 'kaleidoscope', seed: 0x7f3a92c1 };
    expect(lookFromCode('k-7f3a92c1b')).toEqual(look);
    expect(lookFromCode('  K-7F3A92C1B \n')).toEqual(look);
    expect(lookFromCode('K7F3A92C1B')).toEqual(look);
  });
  it('rejects a wrong check digit', () => {
    expect(lookFromCode('K-7F3A92C1C')).toBeNull();
    expect(lookFromCode('K-7F3A92C10')).toBeNull();
  });
  it('rejects unknown letter, bad length, non-hex, empty, non-string', () => {
    expect(lookFromCode('X-7F3A92C1D')).toBeNull();
    expect(lookFromCode('K-7F3A92C1')).toBeNull();
    expect(lookFromCode('K-7F3A92C1BD')).toBeNull();
    expect(lookFromCode('K')).toBeNull();
    expect(lookFromCode('K-7F3A92CZB')).toBeNull();
    expect(lookFromCode('')).toBeNull();
    expect(lookFromCode('   ')).toBeNull();
    for (const x of [null, undefined, 5, {}, []]) expect(lookFromCode(x as unknown as string)).toBeNull();
  });
  it('rejects any single hex digit change (8 positions x 15 alternatives)', () => {
    const r = mulberry32(21);
    const hex = '0123456789ABCDEF';
    let checked = 0;
    for (let n = 0; n < 5; n++) {
      const code = lookToCode({ style: LOOK_STYLES[n % 4], seed: randomSeed32(r) });
      for (let pos = 0; pos < 8; pos++) {
        const idx = 2 + pos;
        for (const ch of hex) {
          if (ch === code[idx]) continue;
          const bad = code.slice(0, idx) + ch + code.slice(idx + 1);
          expect(lookFromCode(bad)).toBeNull();
          checked++;
        }
      }
    }
    expect(checked).toBe(5 * 8 * 15);
  });
});
