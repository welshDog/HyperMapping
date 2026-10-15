import { describe, expect, it } from 'vitest';
import { createScanGate } from './scan-gate';

describe('createScanGate', () => {
  it('rejects a result before all frames are done and accepts after the last', () => {
    const g = createScanGate(3);
    expect(g.canAcceptResult()).toBe(false);
    g.frameDone(0);
    g.frameDone(1);
    expect(g.canAcceptResult()).toBe(false);
    g.frameDone(2);
    expect(g.canAcceptResult()).toBe(true);
  });
  it('does not count duplicate or out-of-order frame-done twice', () => {
    const g = createScanGate(3);
    g.frameDone(0);
    g.frameDone(0);
    g.frameDone(2);
    g.frameDone(0);
    expect(g.canAcceptResult()).toBe(false);
    g.frameDone(1);
    g.frameDone(2);
    g.frameDone(2);
    expect(g.canAcceptResult()).toBe(true);
  });
  it('a fresh gate per scan rejects an old result', () => {
    const old = createScanGate(2);
    old.frameDone(0);
    old.frameDone(1);
    expect(old.canAcceptResult()).toBe(true);
    expect(createScanGate(2).canAcceptResult()).toBe(false);
  });
  it('a zero-frame scan never accepts', () => {
    expect(createScanGate(0).canAcceptResult()).toBe(false);
  });
});
