import { MAX_BODY_CHARS } from './protocol';

export type Box = 'to-phone' | 'to-laptop';
export interface Stored {
  seq: number;
  body: string;
}

export const MAX_SESSIONS = 4;
export const MAX_MESSAGES = 64;
export const MAX_BOX_CHARS = 8_000_000;
export const IDLE_MS = 15 * 60 * 1000;
const SESSION = /^[0-9a-f]{32}$/;

interface Session {
  touched: number;
  boxes: Record<Box, Stored[]>;
}

export interface Mailbox {
  post(session: string, box: Box, body: string): 'ok' | 'bad' | 'too-big' | 'full';
  after(session: string, box: Box, afterSeq: number): Stored[];
  /** The highest sequence number currently in a box, or 0. */
  latest(session: string, box: Box): number;
}

const isBox = (b: unknown): b is Box => b === 'to-phone' || b === 'to-laptop';

/** An in-memory message mailbox for one laptop and one phone, with hard caps. */
export function createMailbox(clock: () => number = Date.now): Mailbox {
  const sessions = new Map<string, Session>();
  // Seeded from the clock so sequence numbers keep rising across a server restart.
  let counter = clock();

  const sweep = () => {
    const now = clock();
    for (const [id, s] of sessions) if (now - s.touched > IDLE_MS) sessions.delete(id);
  };

  return {
    post(session, box, body) {
      if (!SESSION.test(session) || !isBox(box)) return 'bad';
      if (body.length > MAX_BODY_CHARS) return 'too-big';
      sweep();
      let s = sessions.get(session);
      if (!s) {
        if (sessions.size >= MAX_SESSIONS) return 'full';
        s = { touched: clock(), boxes: { 'to-phone': [], 'to-laptop': [] } };
        sessions.set(session, s);
      }
      s.touched = clock();
      const list = s.boxes[box];
      list.push({ seq: ++counter, body });
      let chars = list.reduce((n, m) => n + m.body.length, 0);
      while (list.length > MAX_MESSAGES || (chars > MAX_BOX_CHARS && list.length > 1)) {
        chars -= list[0].body.length;
        list.shift();
      }
      return 'ok';
    },
    after(session, box, afterSeq) {
      if (!SESSION.test(session) || !isBox(box)) return [];
      sweep();
      const s = sessions.get(session);
      if (!s) return [];
      s.touched = clock();
      return s.boxes[box].filter((m) => m.seq > afterSeq);
    },
    latest(session, box) {
      if (!SESSION.test(session) || !isBox(box)) return 0;
      sweep();
      const s = sessions.get(session);
      if (!s) return 0;
      s.touched = clock();
      const list = s.boxes[box];
      return list.length ? list[list.length - 1].seq : 0;
    },
  };
}
