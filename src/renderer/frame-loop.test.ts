import { describe, it, expect } from 'vitest';
import { FrameLoop } from './frame-loop';

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
