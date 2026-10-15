import { describe, it, expect } from 'vitest';
import { listenResultForError } from './listener';

describe('listenResultForError', () => {
  it('maps permission errors to denied', () => {
    expect(listenResultForError('NotAllowedError')).toBe('denied');
    expect(listenResultForError('SecurityError')).toBe('denied');
  });
  it('maps missing hardware to no-mic', () => {
    expect(listenResultForError('NotFoundError')).toBe('no-mic');
    expect(listenResultForError('OverconstrainedError')).toBe('no-mic');
  });
  it('maps everything else to unsupported', () => {
    expect(listenResultForError('NotReadableError')).toBe('unsupported');
    expect(listenResultForError('AbortError')).toBe('unsupported');
    expect(listenResultForError('')).toBe('unsupported');
  });
});
