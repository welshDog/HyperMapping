import { useEffect } from 'react';

/** Minimal structural types so the controller can be tested with plain fakes in Node. */
export interface WakeLockSentinelLike {
  readonly released?: boolean;
  release(): Promise<void>;
}
export interface WakeLockNav {
  wakeLock?: { request(type: 'screen'): Promise<WakeLockSentinelLike> };
}
export interface WakeLockDoc {
  readonly visibilityState: string;
  addEventListener(type: 'visibilitychange', fn: () => void): void;
  removeEventListener(type: 'visibilitychange', fn: () => void): void;
}

export interface WakeLockController {
  setActive(active: boolean): void;
  dispose(): void;
}

/**
 * Keeps the screen awake while active. The browser drops the lock whenever the
 * page is hidden, so it is re-requested when the page becomes visible again.
 * Every failure (unsupported, denied, low battery) is ignored: a dimming screen
 * is annoying, not fatal.
 */
export function createWakeLockController(nav: WakeLockNav, doc: WakeLockDoc): WakeLockController {
  let active = false;
  let pending = false;
  let sentinel: WakeLockSentinelLike | null = null;

  const releaseQuietly = (s: WakeLockSentinelLike) => {
    try {
      s.release().catch(() => {});
    } catch {
      /* already released */
    }
  };

  const acquire = async () => {
    if (!nav.wakeLock || pending) return;
    if (sentinel && sentinel.released !== true) return;
    pending = true;
    try {
      const s = await nav.wakeLock.request('screen');
      if (active) sentinel = s;
      else releaseQuietly(s); // deactivated while the request was in flight
    } catch {
      /* not allowed / not supported right now */
    } finally {
      pending = false;
    }
  };

  const onVisibility = () => {
    if (active && doc.visibilityState === 'visible') void acquire();
  };
  doc.addEventListener('visibilitychange', onVisibility);

  const setActive = (next: boolean) => {
    if (next === active) return;
    active = next;
    if (active) {
      void acquire();
    } else if (sentinel) {
      releaseQuietly(sentinel);
      sentinel = null;
    }
  };

  return {
    setActive,
    dispose() {
      setActive(false);
      doc.removeEventListener('visibilitychange', onVisibility);
    },
  };
}

/** Hold a screen wake lock for as long as `active` is true. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const c = createWakeLockController(navigator as WakeLockNav, document);
    c.setActive(true);
    return () => c.dispose();
  }, [active]);
}
