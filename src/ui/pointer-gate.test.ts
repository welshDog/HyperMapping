import { describe, it, expect } from 'vitest';
import { createPointerGate } from './pointer-gate';

describe('createPointerGate', () => {
  it('lets the first finger own the drag and ignores a second one', () => {
    const g = createPointerGate();
    expect(g.down(1)).toBe(true);
    expect(g.down(2)).toBe(false);
    expect(g.owns(1)).toBe(true);
    expect(g.owns(2)).toBe(false);
  });

  it('ignores a release from a finger that does not own the drag', () => {
    const g = createPointerGate();
    g.down(1);
    g.down(2);
    expect(g.up(2)).toBe(false);
    expect(g.owns(1)).toBe(true); // the owner is still dragging
  });

  it('frees the gate when the owner lifts, so the next finger can drag', () => {
    const g = createPointerGate();
    g.down(1);
    expect(g.up(1)).toBe(true);
    expect(g.owns(1)).toBe(false);
    expect(g.down(2)).toBe(true);
    expect(g.owns(2)).toBe(true);
  });

  it('owns nothing before any finger is down, and an idle release does nothing', () => {
    const g = createPointerGate();
    expect(g.owns(1)).toBe(false);
    expect(g.up(1)).toBe(false);
  });

  it('can be reset (selection changed mid-drag) and reports whether a drag was active', () => {
    const g = createPointerGate();
    expect(g.reset()).toBe(false);
    g.down(1);
    expect(g.reset()).toBe(true);
    expect(g.owns(1)).toBe(false);
    expect(g.down(2)).toBe(true);
  });

  it('treats pointer id 0 (a mouse) as a real owner', () => {
    const g = createPointerGate();
    expect(g.down(0)).toBe(true);
    expect(g.owns(0)).toBe(true);
    expect(g.down(5)).toBe(false);
    expect(g.up(0)).toBe(true);
  });
});
