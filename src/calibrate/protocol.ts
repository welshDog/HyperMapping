import type { ScanMap } from './decode';

/** Largest message the relay and the parsers accept (a scan result is the big one). */
export const MAX_BODY_CHARS = 4_000_000;
const MAX_PREVIEW_CHARS = 400_000;
const JPEG_PREFIX = 'data:image/jpeg;base64,';
const MAX_DIM = 4096;
const MAX_PIXELS = 2_000_000;
const MAX_GRID = 2048;
const MAX_FRAMES = 1000;

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(text: string): Uint8Array | null {
  try {
    const bin = atob(text);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

export function encodeU16(a: Uint16Array): string {
  const bytes = new Uint8Array(a.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < a.length; i++) view.setUint16(i * 2, a[i], true);
  return toBase64(bytes);
}

export function decodeU16(text: string, length: number): Uint16Array | null {
  const bytes = fromBase64(text);
  if (!bytes || bytes.length !== length * 2) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = new Uint16Array(length);
  for (let i = 0; i < length; i++) out[i] = view.getUint16(i * 2, true);
  return out;
}

export type LaptopMsg =
  | { type: 'show'; frame: number; of: number }
  | { type: 'scan-start'; gw: number; gh: number }
  | { type: 'scan-cancel' };

export type PhoneMsg =
  | { type: 'hello'; width: number; height: number }
  | { type: 'ready' }
  | { type: 'frame-done'; frame: number }
  | { type: 'scan-result'; map: ScanMap; preview: string }
  | { type: 'error'; reason: 'moved' | 'camera' | 'timeout' | 'dark' | 'other'; detail?: string };

export type CalibMsg = LaptopMsg | PhoneMsg;

const ERROR_REASONS = ['moved', 'camera', 'timeout', 'dark', 'other'] as const;

export function encodeCalibMsg(msg: CalibMsg): string {
  if (msg.type === 'scan-result') {
    const { map } = msg;
    return JSON.stringify({
      type: 'scan-result',
      width: map.width,
      height: map.height,
      gw: map.gw,
      gh: map.gh,
      mapX: encodeU16(map.mapX),
      mapY: encodeU16(map.mapY),
      mask: toBase64(map.mask),
      preview: msg.preview,
    });
  }
  return JSON.stringify(msg);
}

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

/** Validate anything that arrives from the other device; never trust the wire. */
export function parseCalibMsg(text: unknown): CalibMsg | null {
  if (typeof text !== 'string' || text.length > MAX_BODY_CHARS) return null;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  switch (d.type) {
    case 'show':
      return isInt(d.of, 1, MAX_FRAMES) && isInt(d.frame, 0, MAX_FRAMES) && d.frame < d.of
        ? { type: 'show', frame: d.frame, of: d.of }
        : null;
    case 'scan-start':
      return isInt(d.gw, 1, MAX_GRID) && isInt(d.gh, 1, MAX_GRID) ? { type: 'scan-start', gw: d.gw, gh: d.gh } : null;
    case 'scan-cancel':
      return { type: 'scan-cancel' };
    case 'hello':
      return isInt(d.width, 1, MAX_DIM) && isInt(d.height, 1, MAX_DIM) && d.width * d.height <= MAX_PIXELS
        ? { type: 'hello', width: d.width, height: d.height }
        : null;
    case 'ready':
      return { type: 'ready' };
    case 'frame-done':
      return isInt(d.frame, 0, MAX_FRAMES) ? { type: 'frame-done', frame: d.frame } : null;
    case 'error': {
      const reason = ERROR_REASONS.find((r) => r === d.reason);
      if (!reason) return null;
      const detail = typeof d.detail === 'string' && d.detail.length <= 200 ? d.detail : undefined;
      return detail === undefined ? { type: 'error', reason } : { type: 'error', reason, detail };
    }
    case 'scan-result': {
      const { width, height, gw, gh } = d;
      if (!isInt(width, 1, MAX_DIM) || !isInt(height, 1, MAX_DIM) || width * height > MAX_PIXELS) return null;
      if (!isInt(gw, 1, MAX_GRID) || !isInt(gh, 1, MAX_GRID)) return null;
      if (typeof d.preview !== 'string' || !d.preview.startsWith(JPEG_PREFIX) || d.preview.length > MAX_PREVIEW_CHARS) return null;
      if (typeof d.mapX !== 'string' || typeof d.mapY !== 'string' || typeof d.mask !== 'string') return null;
      const n = width * height;
      const mapX = decodeU16(d.mapX, n);
      const mapY = decodeU16(d.mapY, n);
      const mask = fromBase64(d.mask);
      if (!mapX || !mapY || !mask || mask.length !== n) return null;
      return { type: 'scan-result', map: { width, height, gw, gh, mapX, mapY, mask }, preview: d.preview };
    }
    default:
      return null;
  }
}
