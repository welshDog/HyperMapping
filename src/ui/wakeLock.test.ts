import { describe, it, expect } from 'vitest';
import { createWakeLockController, type WakeLockDoc, type WakeLockNav } from './wakeLock';

const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeSentinel() {
  return {
    released: false,
    releases: 0,
    release() {
      this.released = true;
      this.releases++;
      return Promise.resolve();
    },
  };
}

function fakeNav(opts: { reject?: boolean } = {}) {
  const sentinels: ReturnType<typeof fakeSentinel>[] = [];
  const nav: WakeLockNav & { sentinels: typeof sentinels } = {
    sentinels,
    wakeLock: {
      request: () => {
        if (opts.reject) return Promise.reject(new Error('NotAllowedError'));
        const s = fakeSentinel();
        sentinels.push(s);
        return Promise.resolve(s);
      },
    },
  };
  return nav;
}

function fakeDoc() {
  const listeners = new Set<() => void>();
  let visibility = 'visible';
  const doc: WakeLockDoc & { fire(state: 'visible' | 'hidden'): void; count(): number } = {
    get visibilityState() {
      return visibility;
    },
    addEventListener: (_t: 'visibilitychange', fn: () => void) => void listeners.add(fn),
    removeEventListener: (_t: 'visibilitychange', fn: () => void) => void listeners.delete(fn),
    fire(state) {
      visibility = state;
      listeners.forEach((fn) => fn());
    },
    count: () => listeners.size,
  };
  return doc;
}

describe('createWakeLockController', () => {
  it('acquires a screen wake lock when activated', async () => {
    const nav = fakeNav();
    const c = createWakeLockController(nav, fakeDoc());
    c.setActive(true);
    await flush();
    expect(nav.sentinels.length).toBe(1);
    expect(nav.sentinels[0].released).toBe(false);
  });

  it('releases on deactivate', async () => {
    const nav = fakeNav();
    const c = createWakeLockController(nav, fakeDoc());
    c.setActive(true);
    await flush();
    c.setActive(false);
    expect(nav.sentinels[0].released).toBe(true);
  });

  it('releases a lock that arrives after it was deactivated', async () => {
    const nav = fakeNav();
    const c = createWakeLockController(nav, fakeDoc());
    c.setActive(true);
    c.setActive(false); // request still pending
    await flush();
    expect(nav.sentinels.length).toBe(1);
    expect(nav.sentinels[0].released).toBe(true);
  });

  it('re-acquires after the page becomes visible again', async () => {
    const nav = fakeNav();
    const doc = fakeDoc();
    const c = createWakeLockController(nav, doc);
    c.setActive(true);
    await flush();
    // The browser drops the lock when the page is hidden.
    nav.sentinels[0].released = true;
    doc.fire('hidden');
    doc.fire('visible');
    await flush();
    expect(nav.sentinels.length).toBe(2);
    expect(nav.sentinels[1].released).toBe(false);
  });

  it('does not re-acquire on visibility when inactive', async () => {
    const nav = fakeNav();
    const doc = fakeDoc();
    createWakeLockController(nav, doc);
    doc.fire('visible');
    await flush();
    expect(nav.sentinels.length).toBe(0);
  });

  it('dispose releases and removes the visibility listener', async () => {
    const nav = fakeNav();
    const doc = fakeDoc();
    const c = createWakeLockController(nav, doc);
    c.setActive(true);
    await flush();
    c.dispose();
    expect(nav.sentinels[0].released).toBe(true);
    expect(doc.count()).toBe(0);
  });

  it('tolerates a missing navigator.wakeLock', async () => {
    const c = createWakeLockController({}, fakeDoc());
    expect(() => c.setActive(true)).not.toThrow();
    await flush();
    expect(() => c.setActive(false)).not.toThrow();
  });

  it('tolerates a rejecting request', async () => {
    const nav = fakeNav({ reject: true });
    const c = createWakeLockController(nav, fakeDoc());
    expect(() => c.setActive(true)).not.toThrow();
    await flush();
    expect(() => c.setActive(false)).not.toThrow();
  });
});
