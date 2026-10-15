import { describe, expect, it } from 'vitest';
import { createBeatDetector } from './beat';

describe('createBeatDetector', () => {
  it('a steady level makes no beats after warm-up', () => {
    const d = createBeatDetector();
    let beats = 0;
    for (let t = 0; t < 5000; t += 33) if (d.update(0.6, t) && t > 1000) beats++;
    expect(beats).toBe(0);
  });
  it('120 BPM pulse train over 10 s gives 17..21 beats, >= 250 ms apart', () => {
    const d = createBeatDetector();
    const times: number[] = [];
    for (let i = 0; i * 33 < 10000; i++) {
      const t = i * 33;
      const pulse = Math.floor((t % 500) / 33) < 3;
      if (d.update(pulse ? 0.9 : 0.15, t)) times.push(t);
    }
    expect(times.length).toBeGreaterThanOrEqual(17);
    expect(times.length).toBeLessThanOrEqual(21);
    for (let i = 1; i < times.length; i++) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(250);
  });
  it('a blip below the minimum level never fires', () => {
    const d = createBeatDetector();
    let t = 0;
    for (let i = 0; i < 40; i++, t += 33) d.update(0.05, t);
    expect(d.update(0.25, t)).toBe(false);
  });
  it('reset clears the window and the last-beat time', () => {
    const d = createBeatDetector();
    let t = 0;
    for (let i = 0; i < 40; i++, t += 33) d.update(0.1, t);
    expect(d.update(0.9, t)).toBe(true);
    d.reset();
    expect(d.update(0.9, t + 33)).toBe(false); // warming up again
    for (let i = 0; i < 40; i++) d.update(0.1, t + 66 + i * 33);
    expect(d.update(0.9, t + 66 + 40 * 33)).toBe(true);
  });
});
