import { describe, it, expect } from 'vitest';
import { runScan } from './scan-driver';

function recorder() {
  const log: string[] = [];
  return {
    log,
    deps: {
      showFrame: (i: number) => void log.push(`show${i}`),
      settle: async () => void log.push('settle'),
      capture: async (i: number) => void log.push(`capture${i}`),
      onProgress: (d: number, t: number) => void log.push(`progress${d}/${t}`),
    },
  };
}

describe('runScan', () => {
  it('shows, settles, captures and reports for every frame, in order', async () => {
    const r = recorder();
    expect(await runScan(2, r.deps, { cancelled: false })).toBe('done');
    expect(r.log).toEqual(['show0', 'settle', 'capture0', 'progress1/2', 'show1', 'settle', 'capture1', 'progress2/2']);
  });
  it('stops when cancelled between frames', async () => {
    const r = recorder();
    const signal = { cancelled: false };
    r.deps.capture = async (i: number) => {
      r.log.push(`capture${i}`);
      if (i === 0) signal.cancelled = true;
    };
    expect(await runScan(5, r.deps, signal)).toBe('cancelled');
    expect(r.log.filter((l) => l.startsWith('show'))).toEqual(['show0']);
  });
  it('stops after settling if cancelled during the wait', async () => {
    const r = recorder();
    const signal = { cancelled: false };
    r.deps.settle = async () => {
      signal.cancelled = true;
    };
    expect(await runScan(3, r.deps, signal)).toBe('cancelled');
    expect(r.log).toEqual(['show0']);
  });
  it('passes a capture failure on to the caller', async () => {
    const r = recorder();
    r.deps.capture = async () => {
      throw new Error('phone gone');
    };
    await expect(runScan(3, r.deps, { cancelled: false })).rejects.toThrow('phone gone');
  });
  it('does nothing for an empty scan', async () => {
    const r = recorder();
    expect(await runScan(0, r.deps, { cancelled: false })).toBe('done');
    expect(r.log).toEqual([]);
  });
});
