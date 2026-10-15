import { describe, expect, it } from 'vitest';
import { FRAGMENT_SRC, GLOBAL_UNIFORMS, LOOK_UNIFORMS, lookUniforms, seedToUniform, VERTEX_SRC } from './shaders';
import { LOOK_STYLES, paletteFor, speedFor } from './look';

describe('seedToUniform', () => {
  it('is deterministic and fits exactly in a float32 (24 bits)', () => {
    for (const seed of [0, 1, 255, 256, 0x12345678, 0xffffffff]) {
      const v = seedToUniform(seed);
      expect(v).toBe(seedToUniform(seed));
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 24);
      expect(Math.fround(v)).toBe(v);
    }
  });

  it('lets the low bits of the seed change the value', () => {
    const base = 0xabcdef00;
    const values = new Set(Array.from({ length: 256 }, (_, i) => seedToUniform(base + i)));
    expect(values.size).toBeGreaterThan(250);
  });
});

// Exact inverse of the mixing step inside seedToUniform (before the >>> 8 fold), so the test can
// build two 32-bit seeds that fold to the same shader seed.
function modInverse32(c: number): number {
  let inv = c;
  for (let i = 0; i < 5; i++) inv = Math.imul(inv, 2 - Math.imul(c, inv));
  return inv >>> 0;
}
function unmix(y: number): number {
  let x = (y ^ (y >>> 16)) >>> 0;
  x = Math.imul(x, modInverse32(0x846ca68b)) >>> 0;
  x = (x ^ (x >>> 15) ^ (x >>> 30)) >>> 0;
  x = Math.imul(x, modInverse32(0x7feb352d)) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

describe('lookUniforms', () => {
  it('still gives different palettes for two seeds that fold to the same shader seed', () => {
    const mixed = 0x5eed1200;
    const s1 = unmix(mixed);
    const s2 = unmix(mixed ^ 0x7f); // differs only in the 8 bits the fold drops
    expect(s1).not.toBe(s2);
    expect(seedToUniform(s1)).toBe(seedToUniform(s2));
    const u1 = lookUniforms({ style: 'plasma', seed: s1 });
    const u2 = lookUniforms({ style: 'plasma', seed: s2 });
    expect(u1.seed).toBe(u2.seed);
    expect([u1.a, u1.b, u1.c, u1.d]).not.toEqual([u2.a, u2.b, u2.c, u2.d]);
    expect(u1.speed).not.toBe(u2.speed);
  });

  it('maps the style to its LOOK_STYLES index and copies palette and speed', () => {
    LOOK_STYLES.forEach((style, i) => {
      const u = lookUniforms({ style, seed: 42 });
      expect(u.style).toBe(i);
      expect(u.seed).toBe(seedToUniform(42));
      expect(u.speed).toBe(speedFor(42));
      expect([u.a, u.b, u.c, u.d]).toEqual(Object.values(paletteFor(42)));
    });
  });
});

describe('shader sources', () => {
  it('are GLSL ES 3.00 and declare every uniform the source sets', () => {
    expect(VERTEX_SRC.startsWith('#version 300 es')).toBe(true);
    expect(FRAGMENT_SRC.startsWith('#version 300 es')).toBe(true);
    for (const name of [...GLOBAL_UNIFORMS, ...LOOK_UNIFORMS]) {
      expect(FRAGMENT_SRC).toMatch(new RegExp(`uniform [a-z0-9]+ ${name}[[;]`));
    }
  });

  it('uses u_pulse in the body, not just the declaration', () => {
    expect(FRAGMENT_SRC.split('u_pulse').length - 1).toBeGreaterThan(1);
  });

  it('reads time only through u_time and u_atime (no other clock or randomness)', () => {
    for (const src of [VERTEX_SRC, FRAGMENT_SRC]) {
      const rest = src.replace(/\bu_a?time\b/g, '');
      expect(rest).not.toMatch(/time|clock|date|random|gl_FragCoord/i);
    }
  });

  it('has the audio uniforms u_treble and u_atime as globals', () => {
    expect(GLOBAL_UNIFORMS).toContain('u_pulse');
    expect(GLOBAL_UNIFORMS).toContain('u_treble');
    expect(GLOBAL_UNIFORMS).toContain('u_atime');
    expect(FRAGMENT_SRC).toMatch(/uniform float u_treble;/);
    expect(FRAGMENT_SRC).toMatch(/uniform float u_atime;/);
  });

  it('adds loudness time to the clock in the time expression', () => {
    expect(FRAGMENT_SRC).toMatch(/float t = \(u_time \+ u_atime\) \* speed;/);
    expect(FRAGMENT_SRC).not.toMatch(/float t = u_time \* speed;/);
  });

  it('reacts to treble in every look', () => {
    const bodies = ['lookPlasma', 'lookKaleido', 'lookNeon', 'lookParticles'].map((name) => {
      const start = FRAGMENT_SRC.indexOf(`vec3 ${name}(`);
      expect(start).toBeGreaterThan(-1);
      const end = FRAGMENT_SRC.indexOf('\n}\n', start);
      return FRAGMENT_SRC.slice(start, end);
    });
    for (const body of bodies) {
      expect(body).toMatch(/\bu_treble\b/);
      expect(body).toMatch(/\bu_pulse\b/);
    }
    expect(FRAGMENT_SRC.split('u_treble').length - 1).toBeGreaterThanOrEqual(5); // declaration + 4 looks
  });

  it('caps fbm by u_octaves', () => {
    expect(FRAGMENT_SRC).toMatch(/uniform int u_octaves;/);
    expect(FRAGMENT_SRC).toMatch(/if \(i >= u_octaves\) break;/);
  });

  it('only evaluates the previous look while fading', () => {
    expect(FRAGMENT_SRC).toMatch(/if \(u_fade < 1\.0\)/);
  });
});
