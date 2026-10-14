import { describe, it, expect } from 'vitest';
import { parseMsg, CHANNEL } from './protocol';

const corners = { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] };

describe('parseMsg', () => {
  it('uses a stable channel name', () => {
    expect(CHANNEL).toBe('hypermapping');
  });
  it('accepts hello', () => {
    expect(parseMsg({ type: 'hello' })).toEqual({ type: 'hello' });
  });
  it('accepts a well-formed state message', () => {
    expect(parseMsg({ type: 'state', corners })).toEqual({ type: 'state', corners });
  });
  it('rejects state with a missing corner', () => {
    expect(parseMsg({ type: 'state', corners: { tl: [0, 0] } })).toBeNull();
  });
  it('rejects state with non-finite numbers', () => {
    expect(parseMsg({ type: 'state', corners: { ...corners, tl: [NaN, 0] } })).toBeNull();
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
});
