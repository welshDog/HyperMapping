import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRelayClient } from './relay-client';

type Reply = { ok?: boolean; json?: unknown; throws?: boolean };
interface Fake {
  fn: typeof fetch;
  urls: string[];
}

/** A fetch that answers from a script of replies (the last one repeats). */
function fake(script: Reply[]): Fake {
  const urls: string[] = [];
  let i = 0;
  const fn = (async (url: string) => {
    urls.push(String(url));
    const r = script[Math.min(i++, script.length - 1)];
    if (r.throws) throw new Error('network');
    return { ok: r.ok ?? true, json: async () => r.json } as Response;
  }) as unknown as typeof fetch;
  return { fn, urls };
}

const S = 'a'.repeat(32);
const flush = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms);
};

describe('createRelayClient', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('with skipBacklog never delivers old messages and polls from the returned cursor', async () => {
    const f = fake([{ json: { messages: [], cursor: 7 } }, { json: { messages: [{ seq: 8, body: 'new' }] } }, { json: { messages: [] } }]);
    const c = createRelayClient(S, 'phone', f.fn, { skipBacklog: true });
    const got: string[] = [];
    c.onMessage((t) => got.push(t));
    await flush(10);
    expect(f.urls[0]).toContain('after=latest');
    expect(f.urls[1]).toContain('after=7');
    expect(got).toEqual(['new']);
    c.close();
  });

  it('retries a failing or malformed sync after 1 s without delivering anything', async () => {
    const f = fake([
      { throws: true },
      { json: { messages: [{ seq: 1, body: 'old' }] } }, // no cursor
      { json: { messages: [], cursor: -3 } },
      { json: { messages: [], cursor: 'x' } },
      { ok: false },
      { json: { messages: [], cursor: 4 } },
      { json: { messages: [] } },
    ]);
    const c = createRelayClient(S, 'phone', f.fn, { skipBacklog: true });
    const got: string[] = [];
    c.onMessage((t) => got.push(t));
    await flush(10);
    expect(f.urls.length).toBe(1);
    await flush(1000);
    expect(f.urls.length).toBe(2);
    await flush(4000);
    await c.synced;
    expect(got).toEqual([]);
    expect(f.urls.filter((u) => u.includes('after=latest')).length).toBe(6);
    expect(f.urls.some((u) => u.includes('after=4'))).toBe(true);
    c.close();
  });

  it('close() during a failing sync resolves synced and stops', async () => {
    const f = fake([{ throws: true }]);
    const c = createRelayClient(S, 'phone', f.fn, { skipBacklog: true });
    await flush(10);
    c.close();
    await flush(5000);
    await c.synced;
    expect(f.urls.length).toBe(1);
  });

  it('delivers in order, advances after, and does not spin on an empty answer', async () => {
    const f = fake([
      { json: { messages: [{ seq: 1, body: 'a' }, { seq: 2, body: 'b' }] } },
      { json: { messages: [] } },
      { json: { messages: [{ seq: 3, body: 'c' }] } },
      { json: { messages: [] } },
    ]);
    const c = createRelayClient(S, 'laptop', f.fn);
    const got: string[] = [];
    c.onMessage((t) => got.push(t));
    await flush(10);
    expect(got).toEqual(['a', 'b']);
    expect(f.urls[0]).toContain('after=0');
    expect(f.urls[1]).toContain('after=2');
    expect(f.urls.length).toBe(2); // the empty answer waits instead of re-asking at once
    await flush(250);
    expect(got).toEqual(['a', 'b', 'c']);
    expect(f.urls[2]).toContain('after=2');
    await flush(10);
    expect(f.urls[3]).toContain('after=3');
    c.close();
  });
});
