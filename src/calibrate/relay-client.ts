export interface RelayClient {
  /** Post a message to the other device; resolves false if the server refused or was unreachable. */
  send(text: string): Promise<boolean>;
  /** Called for every message from the other device, in order. */
  onMessage(fn: (text: string) => void): void;
  close(): void;
  /** Resolves once the initial sync is done (already resolved unless skipBacklog was asked for). */
  synced: Promise<void>;
}

/** Talks to the mailbox hosted by the dev/preview server (see tools/calibration-relay.ts). */
export function createRelayClient(session: string, role: 'laptop' | 'phone', fetchFn: typeof fetch = (...a) => fetch(...a),
  options: { skipBacklog?: boolean } = {},
): RelayClient {
  const mine = role === 'laptop' ? 'to-laptop' : 'to-phone';
  const theirs = role === 'laptop' ? 'to-phone' : 'to-laptop';
  const controller = new AbortController();
  let closed = false;
  let handler: ((text: string) => void) | null = null;
  let last = 0;

  /** Jump the cursor to "now" so messages left over from an earlier page load are never replayed. */
  const syncToLatest = async () => {
    while (!closed) {
      try {
        const res = await fetchFn(`/calib/${session}/${mine}?after=latest`, { signal: controller.signal, cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { cursor?: unknown };
        // A missing or malformed cursor is a failed sync: retry rather than guess.
        if (typeof data.cursor !== 'number' || !Number.isFinite(data.cursor) || data.cursor < 0) throw new Error('bad cursor');
        last = data.cursor;
        return;
      } catch {
        if (closed) return;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  };

  const loop = async () => {
    while (!closed) {
      try {
        const res = await fetchFn(`/calib/${session}/${mine}?after=${last}`, { signal: controller.signal, cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { messages?: { seq: number; body: string }[] };
        const msgs = data.messages ?? [];
        let fresh = 0;
        for (const m of msgs) {
          if (typeof m.seq === 'number' && m.seq > last) {
            last = m.seq;
            fresh++;
            try {
              handler?.(m.body);
            } catch {
              // one failing handler must not stall the rest of the batch
            }
          }
        }
        if (fresh === 0) {
          // A server whose sequence numbers went backwards: start again from the beginning.
          if (msgs.length > 0 && msgs.every((m) => typeof m.seq === 'number' && m.seq <= last)) last = 0;
          // Never spin on a server that answers instantly with nothing new.
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      } catch {
        if (closed) return;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  };
  const synced = options.skipBacklog ? syncToLatest() : Promise.resolve();
  void synced.then(loop);

  return {
    synced,
    async send(text) {
      try {
        const res = await fetchFn(`/calib/${session}/${theirs}`, { method: 'POST', body: text, cache: 'no-store' });
        return res.ok;
      } catch {
        return false;
      }
    },
    onMessage(fn) {
      handler = fn;
    },
    close() {
      closed = true;
      controller.abort();
    },
  };
}
