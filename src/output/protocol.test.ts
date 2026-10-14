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
});
