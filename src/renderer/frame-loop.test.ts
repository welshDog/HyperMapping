import { describe, it, expect } from 'vitest';
import { FrameLoop } from './frame-loop';
import { ThermalGuard, type Quality } from './quality';

function fakeRaf() {
  let cb: ((t: number) => void) | null = null;
  let n = 0;
  return {
    raf: (f: (t: number) => void) => ((cb = f), ++n),
    caf: () => {
      cb = null;
    },
    tick: (t: number) => {
      const f = cb;
      cb = null;
      f?.(t);
    },
  };
}

/** Drive a FrameLoop at `hz` rAF ticks for `ticks` ticks, piping into a real ThermalGuard the way useRenderer does. */
function runAtRefresh(hz: number, ticks: number, start?: Quality): Quality {
  const f = fakeRaf();
  const guard = new ThermalGuard();
  if (start) guard.quality = start;
  const loop: FrameLoop = new FrameLoop(
    {
      draw: () => {},
      onFrameTime: (ms) => {
        loop.fpsCap = guard.push(ms).fpsCap;
      },
    },
    f.raf,
    f.caf,
  );
  loop.start();
  for (let k = 0; k < ticks; k++) f.tick((k * 1000) / hz);
  return guard.quality;
}

describe('FrameLoop', () => {
  it('draws every frame at 60fps and reports frame times', () => {
    const f = fakeRaf();
    const times: number[] = [];
    let draws = 0;
    const loop = new FrameLoop({ draw: () => draws++, onFrameTime: (ms) => times.push(ms) }, f.raf, f.caf);
    loop.start();
    [0, 16.7, 33.4, 50.1].forEach(f.tick);
    expect(draws).toBe(4);
    expect(times.length).toBe(3);
    expect(times[0]).toBeCloseTo(16.7, 5);
  });

  it('draws every other frame at a 30fps cap', () => {
    const f = fakeRaf();
    let draws = 0;
    const loop = new FrameLoop({ draw: () => draws++ }, f.raf, f.caf);
    loop.fpsCap = 30;
    loop.start();
    [0, 16.7, 33.4, 50.1, 66.8].forEach(f.tick);
    expect(draws).toBe(3); // t = 0, 33.4, 66.8
  });

  it('a 90 Hz display does not trip the thermal guard', () => {
    expect(runAtRefresh(90, 600)).toEqual({ scale: 1, fpsCap: 60 });
  });

  it('a 144 Hz display does not trip the thermal guard', () => {
    expect(runAtRefresh(144, 600)).toEqual({ scale: 1, fpsCap: 60 });
  });

  it('a 144 Hz display recovers resolution after a step-down', () => {
    expect(runAtRefresh(144, 2400, { scale: 0.8, fpsCap: 60 })).toEqual({ scale: 1, fpsCap: 60 });
  });

  it('a 120 Hz display does not trip the thermal guard', () => {
    expect(runAtRefresh(120, 600)).toEqual({ scale: 1, fpsCap: 60 });
  });

  it('a genuinely slow device on a 60 Hz display still degrades', () => {
    // Draw is slow, so every rAF callback lands a whole vsync late: steady 33.3 ms gaps.
    const q = runAtRefresh(30, 600);
    expect(q.scale).toBeLessThan(1);
  });

  it('a backgrounded-tab gap is treated as a resume, not a slow frame', () => {
    const f = fakeRaf();
    const times: number[] = [];
    let draws = 0;
    const loop = new FrameLoop({ draw: () => draws++, onFrameTime: (ms) => times.push(ms) }, f.raf, f.caf);
    loop.start();
    [0, 16.7, 5000, 5016.7].forEach(f.tick);
    expect(draws).toBe(4);
    expect(times.length).toBe(2);
    expect(times[0]).toBeCloseTo(16.7, 3);
    expect(times[1]).toBeCloseTo(16.7, 3);
  });

  it('stops drawing after stop()', () => {
    const f = fakeRaf();
    let draws = 0;
    const loop = new FrameLoop({ draw: () => draws++ }, f.raf, f.caf);
    loop.start();
    f.tick(0);
    loop.stop();
    f.tick(16.7);
    expect(draws).toBe(1);
  });
});
