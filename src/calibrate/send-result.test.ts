import { describe, it, expect } from 'vitest';
import { helloFailureText, sendResultFor } from './send-result';

describe('sendResultFor', () => {
  it('maps HTTP statuses to a reason', () => {
    expect(sendResultFor(200)).toEqual({ kind: 'ok' });
    expect(sendResultFor(204)).toEqual({ kind: 'ok' });
    expect(sendResultFor(429)).toEqual({ kind: 'busy' });
    expect(sendResultFor(413)).toEqual({ kind: 'too-big' });
    expect(sendResultFor(404)).toEqual({ kind: 'refused', status: 404 });
    expect(sendResultFor(500)).toEqual({ kind: 'refused', status: 500 });
    expect(sendResultFor(400)).toEqual({ kind: 'refused', status: 400 });
  });
  it('treats no response at all (a network error) as unreachable', () => {
    expect(sendResultFor(null)).toEqual({ kind: 'unreachable' });
  });
});

describe('helloFailureText', () => {
  it('says "busy" only when the server really is busy', () => {
    expect(helloFailureText({ kind: 'busy' })).toMatch(/busy/i);
    expect(helloFailureText({ kind: 'unreachable' })).not.toMatch(/busy/i);
    expect(helloFailureText({ kind: 'refused', status: 500 })).not.toMatch(/busy/i);
    expect(helloFailureText({ kind: 'too-big' })).not.toMatch(/busy/i);
  });
  it('tells the user to check Wi-Fi when the laptop cannot be reached', () => {
    expect(helloFailureText({ kind: 'unreachable' })).toMatch(/Wi-Fi/);
  });
  it('includes the error code for other server answers', () => {
    expect(helloFailureText({ kind: 'refused', status: 500 })).toContain('500');
  });
  it('every failure tells the user to tap Start again', () => {
    for (const r of [{ kind: 'busy' }, { kind: 'unreachable' }, { kind: 'too-big' }, { kind: 'refused', status: 404 }] as const) {
      expect(helloFailureText(r)).toMatch(/tap Start/i);
    }
  });
});
