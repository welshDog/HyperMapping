import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultCorners } from '../surfaces/model';
import { FULL_RECT, type Surface } from '../surfaces/types';
import { createAutosaver } from './autosave';

const list = (n: number): Surface[] =>
  Array.from({ length: n }, (_, i) => ({ id: `s${i + 1}`, corners: defaultCorners(i, n), srcRect: FULL_RECT }));

describe('createAutosaver', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves only the latest list, once, after the delay', () => {
    const save = vi.fn();
    const a = createAutosaver(save, 400);
    a.schedule(list(1));
    vi.advanceTimersByTime(300);
    a.schedule(list(2));
    vi.advanceTimersByTime(300); // 600 ms in, but the second schedule restarted the clock
    expect(save).not.toHaveBeenCalled();
    a.schedule(list(3));
    vi.advanceTimersByTime(400);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(list(3));
    vi.advanceTimersByTime(5000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush saves the pending list immediately, exactly once', () => {
    const save = vi.fn();
    const a = createAutosaver(save, 400);
    a.schedule(list(2));
    a.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(list(2));
    a.flush();
    vi.advanceTimersByTime(1000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('flush with nothing pending does nothing', () => {
    const save = vi.fn();
    const a = createAutosaver(save, 400);
    a.flush();
    expect(save).not.toHaveBeenCalled();
    a.schedule(list(1));
    vi.advanceTimersByTime(400);
    a.flush(); // already saved by the timer
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('cancel drops the pending save', () => {
    const save = vi.fn();
    const a = createAutosaver(save, 400);
    a.schedule(list(1));
    a.cancel();
    vi.advanceTimersByTime(1000);
    a.flush();
    expect(save).not.toHaveBeenCalled();
  });

  it('a throwing save does not break later saves', () => {
    const save = vi.fn().mockImplementationOnce(() => {
      throw new Error('quota');
    });
    const a = createAutosaver(save, 400);
    a.schedule(list(1));
    expect(() => vi.advanceTimersByTime(400)).not.toThrow();
    a.schedule(list(2));
    vi.advanceTimersByTime(400);
    expect(save).toHaveBeenCalledTimes(2);
    expect(save).toHaveBeenLastCalledWith(list(2));
  });
});
