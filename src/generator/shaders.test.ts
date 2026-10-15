import { describe, expect, it } from 'vitest';
import { FRAGMENT_SRC, lookUniforms, seedToUniform, VERTEX_SRC } from './shaders';
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

describe('lookUniforms', () => {
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
    for (const name of ['u_res', 'u_time', 'u_fade', 'u_pulse', 'u_style', 'u_seed', 'u_speed', 'u_pa', 'u_pb', 'u_pc', 'u_pd']) {
      expect(FRAGMENT_SRC).toMatch(new RegExp(`uniform [a-z0-9]+ ${name}[[;]`));
    }
  });

  it('uses u_pulse in the body, not just the declaration', () => {
    expect(FRAGMENT_SRC.split('u_pulse').length - 1).toBeGreaterThan(1);
  });

  it('only evaluates the previous look while fading', () => {
    expect(FRAGMENT_SRC).toMatch(/if \(u_fade < 1\.0\)/);
  });
});
