import { describe, it, expect } from 'vitest';
import { ThermalGuard, type Quality } from './quality';

function feed(g: ThermalGuard, ms: number, n: number): Quality {
  let q = g.quality;
  for (let i = 0; i < n; i++) q = g.push(ms);
  return q;
}

describe('ThermalGuard', () => {
  it('starts at full quality', () => {
    expect(new ThermalGuard().quality).toEqual({ scale: 1, fpsCap: 60 });
  });

  it('does nothing until a full window has been collected', () => {
    expect(feed(new ThermalGuard(), 40, 59).scale).toBe(1);
  });

  it('steps resolution down 0.1 per slow window', () => {
    const g = new ThermalGuard();
    expect(feed(g, 30, 60).scale).toBe(0.9);
    expect(feed(g, 30, 60).scale).toBe(0.8);
  });

  it('floors at 0.5 resolution, then drops to 30fps', () => {
    const g = new ThermalGuard();
    const q = feed(g, 30, 60 * 5);
    expect(q).toEqual({ scale: 0.5, fpsCap: 60 });
    expect(feed(g, 30, 60)).toEqual({ scale: 0.5, fpsCap: 30 });
  });

  it('recovers resolution one step after five healthy windows', () => {
    const g = new ThermalGuard();
    feed(g, 30, 120); // scale 0.8
    expect(feed(g, 10, 60 * 5).scale).toBe(0.9);
    expect(feed(g, 10, 60 * 5).scale).toBe(1);
  });

  it('never raises the fps cap or resolution once capped (no oscillation)', () => {
    const g = new ThermalGuard();
    feed(g, 30, 60 * 6); // capped at 30fps, scale 0.5
    expect(feed(g, 33, 60 * 20)).toEqual({ scale: 0.5, fpsCap: 30 });
  });
});
