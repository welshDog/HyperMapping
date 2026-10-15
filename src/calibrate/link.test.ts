import { describe, it, expect } from 'vitest';
import { buildCameraLink, newSessionId } from './link';

describe('newSessionId', () => {
  it('is 32 lowercase hex characters built from 16 random bytes', () => {
    const id = newSessionId((b) => {
      b.forEach((_, i) => (b[i] = i * 17));
      return b;
    });
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(id.startsWith('00112233')).toBe(true);
  });
  it('differs between calls with the real generator', () => {
    expect(newSessionId()).not.toBe(newSessionId());
  });
});

describe('buildCameraLink', () => {
  const s = 'a'.repeat(32);
  it('builds an https link to the camera page', () => {
    expect(buildCameraLink('192.168.1.20', '5173', 'https:', s)).toBe(`https://192.168.1.20:5173/camera.html?s=${s}`);
  });
  it('leaves out an empty port', () => {
    expect(buildCameraLink('192.168.1.20', '', 'https:', s)).toBe(`https://192.168.1.20/camera.html?s=${s}`);
  });
});
