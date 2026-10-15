import { describe, it, expect } from 'vitest';
import { parseMsg, CHANNEL } from './protocol';

const corners = { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] };
const rect = { u0: 0, v0: 0, u1: 1, v1: 1 };
const surface = (id = 's1', over: Record<string, unknown> = {}) => ({ id, corners, srcRect: rect, ...over });

describe('parseMsg', () => {
  it('uses a stable channel name', () => {
    expect(CHANNEL).toBe('hypermapping');
  });
  it('accepts hello', () => {
    expect(parseMsg({ type: 'hello' })).toEqual({ type: 'hello' });
  });
  it('accepts a well-formed surfaces message', () => {
    const msg = { type: 'surfaces', surfaces: [surface('s1'), surface('s2')] };
    expect(parseMsg(msg)).toEqual(msg);
  });
  it('strips unknown fields (rebuilds from validated parts)', () => {
    const out = parseMsg({ type: 'surfaces', surfaces: [surface('s1', { evil: 1 })], extra: true });
    expect(out).toEqual({ type: 'surfaces', surfaces: [surface('s1')] });
  });
  it('rejects an empty list, more than 6 faces and a non-array', () => {
    expect(parseMsg({ type: 'surfaces', surfaces: [] })).toBeNull();
    const seven = Array.from({ length: 7 }, (_, i) => surface('s' + (i + 1)));
    expect(parseMsg({ type: 'surfaces', surfaces: seven })).toBeNull();
    expect(parseMsg({ type: 'surfaces', surfaces: 'nope' })).toBeNull();
    expect(parseMsg({ type: 'surfaces' })).toBeNull();
  });
  it('rejects duplicate, missing, non-string and over-long ids', () => {
    expect(parseMsg({ type: 'surfaces', surfaces: [surface('a'), surface('a')] })).toBeNull();
    expect(parseMsg({ type: 'surfaces', surfaces: [surface('', {})] })).toBeNull();
    expect(parseMsg({ type: 'surfaces', surfaces: [surface('a', { id: 5 })] })).toBeNull();
    expect(parseMsg({ type: 'surfaces', surfaces: [surface('x'.repeat(33))] })).toBeNull();
  });
  it('rejects a face with a missing or non-finite corner', () => {
    expect(parseMsg({ type: 'surfaces', surfaces: [surface('a', { corners: { tl: [0, 0] } })] })).toBeNull();
    expect(parseMsg({ type: 'surfaces', surfaces: [surface('a', { corners: { ...corners, tl: [NaN, 0] } })] })).toBeNull();
  });
  it('rejects a bad slice: missing, zero-size, inverted, out of range, non-finite', () => {
    const bad = (srcRect: unknown) => parseMsg({ type: 'surfaces', surfaces: [surface('a', { srcRect })] });
    expect(bad(undefined)).toBeNull();
    expect(bad({ u0: 0.5, v0: 0, u1: 0.5, v1: 1 })).toBeNull();
    expect(bad({ u0: 0.8, v0: 0, u1: 0.2, v1: 1 })).toBeNull();
    expect(bad({ u0: -0.1, v0: 0, u1: 1, v1: 1 })).toBeNull();
    expect(bad({ u0: 0, v0: 0, u1: 1.5, v1: 1 })).toBeNull();
    expect(bad({ u0: NaN, v0: 0, u1: 1, v1: 1 })).toBeNull();
    expect(bad({ u0: '0', v0: 0, u1: 1, v1: 1 })).toBeNull();
  });
  it('no longer accepts the old state message', () => {
    expect(parseMsg({ type: 'state', corners })).toBeNull();
  });
  it('accepts a video message carrying a Blob', () => {
    const blob = new Blob(['x']);
    expect(parseMsg({ type: 'video', blob })).toEqual({ type: 'video', blob });
  });
  it('rejects video without a Blob', () => {
    expect(parseMsg({ type: 'video', blob: 'nope' })).toBeNull();
  });
  it('rejects unknown types and non-objects', () => {
    expect(parseMsg({ type: 'wat' })).toBeNull();
    expect(parseMsg('hello')).toBeNull();
    expect(parseMsg(null)).toBeNull();
  });
  it('accepts a well-formed layout message', () => {
    const msg = { type: 'layout', surfaces: [surface('s1'), surface('s2')] };
    expect(parseMsg(msg)).toEqual(msg);
  });
  it('rejects a layout message for every case surfaces rejects', () => {
    const bad = (surfaces: unknown) => parseMsg({ type: 'layout', surfaces });
    expect(bad([])).toBeNull();
    expect(bad('nope')).toBeNull();
    expect(bad(undefined)).toBeNull();
    expect(bad(Array.from({ length: 7 }, (_, i) => surface('s' + (i + 1))))).toBeNull();
    expect(bad([surface('a'), surface('a')])).toBeNull();
    expect(bad([surface('a', { corners: { ...corners, tl: [NaN, 0] } })])).toBeNull();
    expect(bad([surface('a', { srcRect: { u0: 0.5, v0: 0, u1: 0.5, v1: 1 } })])).toBeNull();
    expect(bad([null])).toBeNull();
  });
  it('strips unknown fields from a layout message', () => {
    const out = parseMsg({ type: 'layout', surfaces: [surface('s1', { evil: 1 })], extra: true });
    expect(out).toEqual({ type: 'layout', surfaces: [surface('s1')] });
  });
  it('accepts a pattern message with a boolean flag', () => {
    expect(parseMsg({ type: 'pattern', on: true })).toEqual({ type: 'pattern', on: true });
    expect(parseMsg({ type: 'pattern', on: false })).toEqual({ type: 'pattern', on: false });
  });
  it('rejects a pattern message whose flag is missing or not a boolean', () => {
    expect(parseMsg({ type: 'pattern' })).toBeNull();
    expect(parseMsg({ type: 'pattern', on: 1 })).toBeNull();
    expect(parseMsg({ type: 'pattern', on: 'true' })).toBeNull();
    expect(parseMsg({ type: 'pattern', on: null })).toBeNull();
  });
  it('drops unknown fields from a pattern message', () => {
    expect(parseMsg({ type: 'pattern', on: true, evil: 1 })).toEqual({ type: 'pattern', on: true });
  });
  it('accepts a probe and an output-size report', () => {
    expect(parseMsg({ type: 'probe' })).toEqual({ type: 'probe' });
    expect(parseMsg({ type: 'output-size', w: 1920, h: 1080, fullscreen: true })).toEqual({
      type: 'output-size',
      w: 1920,
      h: 1080,
      fullscreen: true,
    });
  });
  it('rejects a bad output-size', () => {
    for (const bad of [
      { type: 'output-size', w: 0, h: 10, fullscreen: true },
      { type: 'output-size', w: 10, h: 1.5, fullscreen: true },
      { type: 'output-size', w: 10, h: 10 },
      { type: 'output-size', w: 100000, h: 10, fullscreen: false },
    ]) {
      expect(parseMsg(bad), JSON.stringify(bad)).toBeNull();
    }
  });
  it('accepts a scan frame, or null to go back to normal', () => {
    const base = { type: 'scan-frame', gw: 16, gh: 8, pw: 64, ph: 32 };
    expect(parseMsg({ ...base, spec: { kind: 'white' } })).toEqual({ ...base, spec: { kind: 'white' } });
    expect(parseMsg({ ...base, spec: null })).toEqual({ ...base, spec: null });
    const ones = { type: 'scan-frame', gw: 1, gh: 1, pw: 1, ph: 1, spec: null };
    expect(parseMsg(ones)).toEqual(ones);
  });
  it('rejects a malformed scan frame', () => {
    const base = { type: 'scan-frame', gw: 16, gh: 8, pw: 64, ph: 32 };
    for (const bad of [
      { ...base, spec: { kind: 'nope' } },
      { ...base, spec: undefined },
      { ...base, spec: { kind: 'white' }, gw: 0 },
      { ...base, spec: { kind: 'white' }, pw: 1e9 },
      { ...base, spec: { kind: 'white' }, gh: 'x' },
    ]) {
      expect(parseMsg(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
