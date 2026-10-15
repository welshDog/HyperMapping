export interface RelayClient {
  /** Post a message to the other device; resolves false if the server refused or was unreachable. */
  send(text: string): Promise<boolean>;
  /** Called for every message from the other device, in order. */
  onMessage(fn: (text: string) => void): void;
  close(): void;
}

/** Talks to the mailbox hosted by the dev/preview server (see tools/calibration-relay.ts). */
export function createRelayClient(session: string, role: 'laptop' | 'phone', fetchFn: typeof fetch = (...a) => fetch(...a)): RelayClient {
  const mine = role === 'laptop' ? 'to-laptop' : 'to-phone';
  const theirs = role === 'laptop' ? 'to-phone' : 'to-laptop';
  const controller = new AbortController();
  let closed = false;
  let handler: ((text: string) => void) | null = null;
  let last = 0;

  const loop = async () => {
    while (!closed) {
      try {
        const res = await fetchFn(`/calib/${session}/${mine}?after=${last}`, { signal: controller.signal, cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as { messages?: { seq: number; body: string }[] };
        for (const m of data.messages ?? []) {
          if (typeof m.seq === 'number' && m.seq > last) {
            last = m.seq;
            handler?.(m.body);
          }
        }
      } catch {
        if (closed) return;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  };
  void loop();

  return {
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
