import { describe, it, expect } from 'vitest';
import { createMailbox } from './mailbox';

const S1 = 'a'.repeat(32);
const S2 = 'b'.repeat(32);
const S3 = 'c'.repeat(32);
const S4 = 'd'.repeat(32);
const S5 = 'e'.repeat(32);

describe('mailbox', () => {
  it('returns messages after a sequence number, in order', () => {
    const mb = createMailbox(() => 0);
    expect(mb.post(S1, 'to-phone', 'one')).toBe('ok');
    expect(mb.post(S1, 'to-phone', 'two')).toBe('ok');
    const all = mb.after(S1, 'to-phone', 0);
    expect(all.map((m) => m.body)).toEqual(['one', 'two']);
    expect(mb.after(S1, 'to-phone', all[0].seq).map((m) => m.body)).toEqual(['two']);
    expect(mb.after(S1, 'to-phone', all[1].seq)).toEqual([]);
  });
  it('keeps the two boxes and the sessions separate', () => {
    const mb = createMailbox(() => 0);
    mb.post(S1, 'to-phone', 'a');
    mb.post(S1, 'to-laptop', 'b');
    mb.post(S2, 'to-phone', 'c');
    expect(mb.after(S1, 'to-phone', 0).map((m) => m.body)).toEqual(['a']);
    expect(mb.after(S1, 'to-laptop', 0).map((m) => m.body)).toEqual(['b']);
    expect(mb.after(S2, 'to-phone', 0).map((m) => m.body)).toEqual(['c']);
    expect(mb.after(S3, 'to-phone', 0)).toEqual([]);
  });
  it('refuses bad session ids and boxes', () => {
    const mb = createMailbox(() => 0);
    expect(mb.post('short', 'to-phone', 'x')).toBe('bad');
    expect(mb.post('G'.repeat(32), 'to-phone', 'x')).toBe('bad');
    expect(mb.post(S1, 'to-moon' as never, 'x')).toBe('bad');
    expect(mb.after('short', 'to-phone', 0)).toEqual([]);
  });
  it('refuses a body over the cap', () => {
    const mb = createMailbox(() => 0);
    expect(mb.post(S1, 'to-phone', 'x'.repeat(4_000_001))).toBe('too-big');
    expect(mb.post(S1, 'to-phone', 'x'.repeat(4_000_000))).toBe('ok');
  });
  it('allows at most 4 sessions', () => {
    const mb = createMailbox(() => 0);
    for (const s of [S1, S2, S3, S4]) expect(mb.post(s, 'to-phone', 'x')).toBe('ok');
    expect(mb.post(S5, 'to-phone', 'x')).toBe('full');
    expect(mb.post(S1, 'to-phone', 'y')).toBe('ok');
  });
  it('keeps only the newest 64 messages per box', () => {
    const mb = createMailbox(() => 0);
    for (let i = 0; i < 70; i++) mb.post(S1, 'to-laptop', String(i));
    const all = mb.after(S1, 'to-laptop', 0);
    expect(all.length).toBe(64);
    expect(all[0].body).toBe('6');
    expect(all[63].body).toBe('69');
  });
  it('drops the oldest messages when a box holds too many characters', () => {
    const mb = createMailbox(() => 0);
    mb.post(S1, 'to-laptop', 'x'.repeat(3_000_000));
    mb.post(S1, 'to-laptop', 'y'.repeat(3_000_000));
    mb.post(S1, 'to-laptop', 'z'.repeat(3_000_000));
    const bodies = mb.after(S1, 'to-laptop', 0).map((m) => m.body[0]);
    expect(bodies).toEqual(['y', 'z']);
  });
  it('expires a session that has been idle for 15 minutes, and frees its slot', () => {
    let now = 0;
    const mb = createMailbox(() => now);
    for (const s of [S1, S2, S3, S4]) mb.post(s, 'to-phone', 'x');
    now = 15 * 60 * 1000 + 1;
    expect(mb.after(S1, 'to-phone', 0)).toEqual([]);
    expect(mb.post(S5, 'to-phone', 'x')).toBe('ok');
  });
  it('reading keeps a session alive', () => {
    let now = 0;
    const mb = createMailbox(() => now);
    mb.post(S1, 'to-phone', 'x');
    now = 10 * 60 * 1000;
    mb.after(S1, 'to-phone', 0);
    now = 20 * 60 * 1000;
    expect(mb.after(S1, 'to-phone', 0).length).toBe(1);
  });
  it('issues larger sequence numbers after a restart (later clock)', () => {
    const first = createMailbox(() => 1000);
    const second = createMailbox(() => 2000);
    first.post(S1, 'to-phone', 'x');
    second.post(S1, 'to-phone', 'x');
    expect(second.after(S1, 'to-phone', 0)[0].seq).toBeGreaterThan(first.after(S1, 'to-phone', 0)[0].seq);
  });
});
