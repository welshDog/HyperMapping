import type { KeyValueStore } from './setups';

/** `localStorage` if it really works (not blocked, not full, not private mode), else null. Never throws. */
export function getBrowserStore(): KeyValueStore | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return null;
    const ls = window.localStorage;
    const probe = '__hypermapping_probe__';
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}
