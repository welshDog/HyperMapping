import { describe, it, expect } from 'vitest';
import type { ScanMap } from './decode';
import { MAX_BODY_CHARS, decodeU16, encodeCalibMsg, encodeU16, fromBase64, parseCalibMsg, toBase64, type CalibMsg } from './protocol';

const small: ScanMap = {
  width: 3,
  height: 2,
  gw: 10,
  gh: 6,
  mapX: Uint16Array.from([0, 1, 2, 65535, 4, 5]),
  mapY: Uint16Array.from([5, 4, 3, 2, 1, 0]),
  mask: Uint8Array.from([1, 1, 0, 1, 1, 1]),
};
const preview = 'data:image/jpeg;base64,/9j/4AAQ';

describe('base64 helpers', () => {
  it('round trips bytes, including large arrays', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, i) => i % 251);
    expect(Array.from(fromBase64(toBase64(bytes))!)).toEqual(Array.from(bytes));
  });
  it('round trips Uint16 values with the exact length, little-endian', () => {
    const a = Uint16Array.from([0, 1, 255, 256, 65535]);
    expect(Array.from(decodeU16(encodeU16(a), 5)!)).toEqual(Array.from(a));
    expect(decodeU16(encodeU16(a), 4)).toBeNull();
    expect(fromBase64('***not base64***')).toBeNull();
  });
});

describe('parseCalibMsg', () => {
  const roundTrip = (m: CalibMsg) => parseCalibMsg(encodeCalibMsg(m));
  it('accepts every message type', () => {
    const msgs: CalibMsg[] = [
      { type: 'show', frame: 3, of: 38 },
      { type: 'scan-start', gw: 480, gh: 270 },
      { type: 'scan-cancel' },
      { type: 'hello', width: 640, height: 360 },
      { type: 'ready' },
      { type: 'frame-done', frame: 3 },
      { type: 'error', reason: 'moved' },
      { type: 'error', reason: 'other', detail: 'camera said no' },
    ];
    for (const m of msgs) expect(roundTrip(m)).toEqual(m);
  });
  it('round trips a scan result', () => {
    const got = roundTrip({ type: 'scan-result', map: small, preview });
    expect(got?.type).toBe('scan-result');
    if (got?.type !== 'scan-result') return;
    expect(got.preview).toBe(preview);
    expect(got.map.width).toBe(3);
    expect(Array.from(got.map.mapX)).toEqual(Array.from(small.mapX));
    expect(Array.from(got.map.mapY)).toEqual(Array.from(small.mapY));
    expect(Array.from(got.map.mask)).toEqual(Array.from(small.mask));
  });
  it('rejects non-strings, bad JSON and unknown types', () => {
    expect(parseCalibMsg(42)).toBeNull();
    expect(parseCalibMsg('{nope')).toBeNull();
    expect(parseCalibMsg('{"type":"evil"}')).toBeNull();
    expect(parseCalibMsg('[]')).toBeNull();
    expect(parseCalibMsg('null')).toBeNull();
  });
  it('rejects wrong field types and out-of-range numbers', () => {
    const bad = [
      { type: 'show', frame: -1, of: 10 },
      { type: 'show', frame: 10, of: 10 },
      { type: 'show', frame: 'a', of: 10 },
      { type: 'show', frame: 1, of: 100000 },
      { type: 'scan-start', gw: 0, gh: 5 },
      { type: 'scan-start', gw: 5000, gh: 5 },
      { type: 'hello', width: 0, height: 5 },
      { type: 'hello', width: 5000, height: 5000 },
      { type: 'hello', width: 1.5, height: 5 },
      { type: 'frame-done', frame: 1.5 },
      { type: 'error', reason: 'because' },
    ];
    for (const m of bad) expect(parseCalibMsg(JSON.stringify(m)), JSON.stringify(m)).toBeNull();
  });
  it('rejects a scan result whose maps do not match its size', () => {
    const good = JSON.parse(encodeCalibMsg({ type: 'scan-result', map: small, preview }));
    expect(parseCalibMsg(JSON.stringify({ ...good, width: 4 }))).toBeNull();
    expect(parseCalibMsg(JSON.stringify({ ...good, mask: good.mapX }))).toBeNull();
    expect(parseCalibMsg(JSON.stringify({ ...good, preview: 'http://evil/x.png' }))).toBeNull();
    expect(parseCalibMsg(JSON.stringify({ ...good, preview: 'data:image/jpeg;base64,' + 'A'.repeat(400_001) }))).toBeNull();
  });
  it('rejects a body over the size cap', () => {
    expect(parseCalibMsg('x'.repeat(MAX_BODY_CHARS + 1))).toBeNull();
  });
  it('drops unknown fields and an over-long error detail', () => {
    const got = parseCalibMsg('{"type":"error","reason":"other","detail":"' + 'x'.repeat(500) + '","evil":1}');
    expect(got).toEqual({ type: 'error', reason: 'other' });
  });
});
