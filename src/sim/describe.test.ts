import { describe, it, expect } from 'vitest';
import type { Box } from './box';
import { DEFAULT_BOX, DEFAULT_PROJECTOR } from './defaults';
import { describeSolve } from './describe';
import { solveFaces, type Projector } from './solve';

const CUBE: Box = { width: 1, height: 1, depth: 1, yawDeg: 0 };
const FRONT_ON: Projector = { distance: 3, azimuthDeg: 0, height: 0.5, throwRatio: 1.2, aspect: 16 / 9, shiftY: 0 };

describe('describeSolve', () => {
  it('lists the faces used, left to right, and nothing else for a clean solve', () => {
    // The default throw ratio (1.2) leaves the front and right faces partly outside the image, so use a
    // slightly wider lens here to get a genuinely clean solve.
    const lines = describeSolve(solveFaces(DEFAULT_BOX, { ...DEFAULT_PROJECTOR, throwRatio: 1.0 }));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^Faces used \(left to right\): /);
    for (const f of ['front', 'right', 'top']) expect(lines[0]).toContain(f);
  });
  it('says so when nothing is visible', () => {
    const lines = describeSolve(solveFaces(CUBE, { ...FRONT_ON, distance: 0 }));
    expect(lines).toEqual(['No faces are visible from this projector position.']);
  });
  it('explains a face that is too far outside the image', () => {
    const lines = describeSolve(solveFaces(CUBE, { ...FRONT_ON, throwRatio: 4 }));
    expect(lines).toContain('Skipped front: too far outside the image (widen the throw ratio or move back).');
  });
  it('flags faces partly outside the image', () => {
    const lines = describeSolve(solveFaces(CUBE, { ...FRONT_ON, throwRatio: 1.875 }));
    expect(lines).toContain('Partly outside the projector image: front');
  });
  it('explains a face that is edge-on or too small', () => {
    const lines = describeSolve(solveFaces(CUBE, { ...FRONT_ON, distance: 200 }));
    expect(lines).toContain('Skipped front: edge-on or too small to map from here.');
  });
  it('explains a face behind the projector', () => {
    const lines = describeSolve(
      solveFaces({ width: 1, height: 0.4, depth: 10, yawDeg: 0 }, { ...FRONT_ON, height: 1, distance: 3 }),
    );
    expect(lines).toContain('Skipped top: behind the projector.');
  });
});
