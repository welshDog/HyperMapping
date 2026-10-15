import { describe, expect, it } from 'vitest';
import { GLOBAL_UNIFORMS } from './shaders';
import sourceText from './source.ts?raw';

// source.ts needs WebGL, so it cannot run here; this guard reads its text instead. Comments are stripped
// first, so a mention in a comment cannot satisfy it.
const code = sourceText
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/.*$/gm, '');

describe('source.ts uniform plumbing', () => {
  for (const name of GLOBAL_UNIFORMS) {
    it(`sets ${name} from a uniform1f/2f/1i call`, () => {
      const re = new RegExp(String.raw`\.uniform(?:1f|2f|1i)\(\s*p\.loc\.${name}\s*,`);
      expect(code).toMatch(re);
    });
  }
  it('does not hard-wire u_pulse to a literal', () => {
    expect(code).not.toMatch(/p\.loc\.u_pulse\s*,\s*-?[\d.]+\s*\)/);
    expect(code).toMatch(/p\.loc\.u_pulse\s*,\s*sound\.pulse\s*\)/);
  });
});
