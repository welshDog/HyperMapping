import { describe, it, expect } from 'vitest';
import { qrPath } from './qr';

describe('qrPath', () => {
  it('draws a square QR code for a link', () => {
    const { size, d } = qrPath('https://192.168.1.20:5173/camera.html?s=' + 'a'.repeat(32));
    expect(size).toBeGreaterThanOrEqual(21);
    expect(d.length).toBeGreaterThan(100);
    expect(d).toMatch(/^M/);
  });
  it('is deterministic', () => {
    expect(qrPath('hello')).toEqual(qrPath('hello'));
  });
  it('differs for different text', () => {
    expect(qrPath('hello').d).not.toBe(qrPath('world').d);
  });
});
