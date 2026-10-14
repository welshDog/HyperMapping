import type { Surface } from '../surfaces/types';

export interface Autosaver {
  /** Remember `list` and save it after the delay (each call restarts the delay). */
  schedule(list: Surface[]): void;
  /** Save the pending list right now, if any. */
  flush(): void;
  /** Forget the pending list without saving. */
  cancel(): void;
}

/** Debounced saver: rapid edits cost one write; page-hide can force it out with `flush`. */
export function createAutosaver(save: (list: Surface[]) => void, delayMs: number): Autosaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: Surface[] | null = null;

  const run = () => {
    timer = null;
    const list = pending;
    pending = null;
    if (!list) return;
    try {
      save(list);
    } catch {
      // storage can fail (quota, private mode): the next edit simply tries again
    }
  };

  return {
    schedule(list) {
      pending = list;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(run, delayMs);
    },
    flush() {
      if (timer !== null) clearTimeout(timer);
      run();
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
