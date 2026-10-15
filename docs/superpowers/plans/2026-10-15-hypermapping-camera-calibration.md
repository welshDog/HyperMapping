# HyperMapping Camera Auto-Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Press **Calibrate** in the Editor, scan a QR code with a phone, let the projector flash stripe patterns while the phone watches the box, tap each face's four corners on the phone's picture, and **Apply** the resulting pins.

**Architecture:** Pure, camera-free maths (stripe frames, decoding, corner fitting, messages, mailbox, scan driver) is built first and tested against a simulated camera. A small in-memory mailbox, hosted as a plugin in the existing Vite dev/preview server, carries messages between the laptop and the phone (the browser `BroadcastChannel` cannot cross devices). The phone page captures and decodes the scan; the Editor panel drives it and converts taps to pins. The Output window paints the scan frames on a full-window overlay.

**Tech Stack:** React 18, TypeScript 5.9 (strict), Vitest 2 (Node env), Vite 5 plugin API, Canvas 2D, `getUserMedia`, `qrcode-generator` (one new dependency, pinned).

**Spec:** `docs/superpowers/specs/2026-10-15-camera-calibration-design.md`

## Spec amendments (rulings made while planning; the spec is updated to match)

- `frameCount` for 1920×1080 at `STEP_PX = 4` is **38** (270 rows need 9 bits, not 8).
- Decoded cells that fall outside the grid (possible when the grid is not a power of two) are marked **unreliable** (mask 0), not clamped.
- `tapsToCorners` returns a result object `{ ok: true; corners } | { ok: false; failed: number[]; reason: 'unlit' | 'invalid-quad' }`, not `null`.
- `projectorPointAt` fits a plain least-squares plane (no outlier trimming).
- Output-window messages are `scan-frame { spec, gw, gh, pw, ph }` (spec `null` returns to normal), `probe`, and `output-size { w, h, fullscreen }`; the scan frame is a full-window overlay canvas, so `surfaces` redraws are ignored automatically.
- **Apply is final** (use Setups to save first); Cancel changes nothing.
- The relay request handling is a pure `handleCalibRequest` (tested); the Vite plugin only adapts Node requests to it. The relay also answers `GET /calib/info` with the server's LAN addresses so the QR link is reachable from the phone even when the Editor was opened as `localhost`.
- Accuracy test tolerance is **1 px** (not 0.5).

## Global Constraints

- `STEP_PX = 4`, `SETTLE_MS = 200`, `CAPTURE_FRAMES = 3`, `MIN_CONTRAST = 40`, `MIN_BIT_MARGIN = 12`, `TAP_RADIUS_PX = 8` (camera analysis pixels), analysis width 640 px, `MAX_BODY_CHARS = 4_000_000`, `MAX_SESSIONS = 4`, 64 messages and 8 000 000 characters per mailbox box, idle expiry 15 minutes, long-poll 20 s, frame-done timeout 8 s.
- Scan frame order: white, black, then for the x axis every bit from the most significant down as pattern then inverse, then the same for y.
- Corner order everywhere: tl, tr, br, bl; unit space with Y down; `Surface.srcRect` and ids are never changed by calibration.
- Relay: path must match `/calib/<32 lowercase hex>/<to-phone|to-laptop>` (plus `/calib/info`), in memory only, same-origin (no CORS headers), bodies over the cap are refused.
- Nothing changes the user's pins until **Apply**; any failure, Cancel or a disconnected phone leaves the layout untouched.
- A single `bg-*` colour class per element state; no dev server is started by implementers (the machine is short of RAM): verify with `npx tsc --noEmit`, `npm test`, `npm run build`; test count only goes up (baseline **231**).
- Every commit passes those three commands. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never `git add` anything under `.superpowers/`.
- Working directory for every command: `h:\HYPERFOCUSZONE\HperCore\HyperMapping`.

## Review Focus

1. **A partly lit or unlit tap is refused, never guessed**: `projectorPointAt` returns null and `tapsToCorners` names the failed tap (Task 3 tests).
2. **Grids that are not a power of two** (13×5 cells, 480×270 cells) decode exactly and out-of-grid codes are masked (Tasks 1–2 tests).
3. **Noisy cameras**: ±8 grey-level noise decodes exactly; the margin guard marks, rather than invents, unreadable pixels (Task 2 tests).
4. **Hostile or malformed LAN input**: wrong types, wrong map lengths, oversize bodies, bad paths, too many sessions/messages are refused (Task 4 tests).
5. **Cancel and failure leave the pins alone**: `applyCalibration` is pure and only runs on Apply; the panel clears the Output overlay and closes the relay on every exit (Task 8 read-through).

---

## File Structure

```
src/calibrate/patterns.ts        gray code, frame specs, scan-frame drawing, parseFrameSpec (+ test)
src/calibrate/synth.ts           test-support: renders scan frames through a known homography
src/calibrate/decode.ts          decodeScan -> ScanMap (+ test)
src/calibrate/corners.ts         projectorPointAt, tapsToCorners, applyCalibration, tapToCamera (+ test)
src/calibrate/protocol.ts        phone<->laptop messages, base64 helpers (+ test)
src/calibrate/mailbox.ts         in-memory mailbox (+ test)
src/calibrate/relay-handler.ts   pure HTTP-ish request handling for the relay (+ test)
src/calibrate/scan-driver.ts     runScan (+ test)
src/calibrate/luma.ts            accumulateLuma / finishLuma (+ test)
src/calibrate/steady.ts          isMoving / magnitude (+ test)
src/calibrate/link.ts            newSessionId, buildCameraLink (+ test)
src/calibrate/qr.ts              qrPath (+ test)
src/calibrate/relay-client.ts    fetch-based mailbox client (DOM)
src/calibrate/CameraApp.tsx      the phone page
src/calibrate/camera-main.tsx    its entry
camera.html                      third Vite entry
tools/calibration-relay.ts       Vite plugin adapting Node requests to relay-handler
src/ui/useScanDisplay.ts         Output window overlay + output-size reporting
src/ui/CalibratePanel.tsx        the Editor panel
src/output/protocol.ts           + scan-frame / probe / output-size messages
vite.config.ts                   + plugin, + camera entry
src/ui/Output.tsx, src/ui/Editor.tsx, README.md
```

---

### Task 1: Scan frames

**Files:**
- Create: `src/calibrate/patterns.ts`
- Test: `src/calibrate/patterns.test.ts`

**Interfaces:**
- Produces: `STEP_PX`, `SETTLE_MS`, `CAPTURE_FRAMES`, `bitsFor(n)`, `grayCode(i)`, `fromGray(g)`, `frameCount(gw, gh)`, `type FrameSpec`, `frameSpec(index, gw, gh)`, `bitValue(spec, x, y): 0 | 1`, `type ScanContext`, `drawScanFrame(ctx, spec, pw, ph, gw, gh)`, `parseFrameSpec(raw): FrameSpec | null`.

- [ ] **Step 1: Write the failing test**

`src/calibrate/patterns.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  STEP_PX,
  bitValue,
  bitsFor,
  drawScanFrame,
  frameCount,
  frameSpec,
  fromGray,
  grayCode,
  parseFrameSpec,
  type FrameSpec,
  type ScanContext,
} from './patterns';

describe('gray code', () => {
  it('round trips', () => {
    for (let i = 0; i <= 65536; i++) expect(fromGray(grayCode(i))).toBe(i);
  });
  it('adjacent codes differ in exactly one bit', () => {
    for (let i = 0; i < 4096; i++) {
      const x = grayCode(i) ^ grayCode(i + 1);
      expect(x).not.toBe(0);
      expect(x & (x - 1)).toBe(0);
    }
  });
});

describe('bitsFor and frameCount', () => {
  it('counts the bits needed to address n cells', () => {
    expect([1, 2, 3, 4, 5, 256, 257, 270, 480].map(bitsFor)).toEqual([1, 1, 2, 2, 3, 8, 9, 9, 9]);
  });
  it('counts frames: white, black, then a pattern and its inverse per bit per axis', () => {
    expect(frameCount(480, 270)).toBe(38);
    expect(frameCount(16, 8)).toBe(2 + 2 * 4 + 2 * 3);
  });
});

describe('frameSpec', () => {
  it('orders white, black, x bits (pattern, inverse), then y bits', () => {
    expect(frameSpec(0, 16, 8)).toEqual({ kind: 'white' });
    expect(frameSpec(1, 16, 8)).toEqual({ kind: 'black' });
    expect(frameSpec(2, 16, 8)).toEqual({ kind: 'bit', axis: 'x', bit: 0, bits: 4, inverted: false });
    expect(frameSpec(3, 16, 8)).toEqual({ kind: 'bit', axis: 'x', bit: 0, bits: 4, inverted: true });
    expect(frameSpec(2 + 8, 16, 8)).toEqual({ kind: 'bit', axis: 'y', bit: 0, bits: 3, inverted: false });
    expect(frameSpec(frameCount(16, 8) - 1, 16, 8)).toEqual({ kind: 'bit', axis: 'y', bit: 2, bits: 3, inverted: true });
  });
  it('rejects an index outside the scan', () => {
    expect(() => frameSpec(-1, 16, 8)).toThrow(RangeError);
    expect(() => frameSpec(frameCount(16, 8), 16, 8)).toThrow(RangeError);
    expect(() => frameSpec(1.5, 16, 8)).toThrow(RangeError);
  });
  it('gives every cell of a non-power-of-two grid a distinct code', () => {
    const gw = 13;
    const gh = 5;
    const seen = new Set<string>();
    for (let y = 0; y < gh; y++) {
      for (let x = 0; x < gw; x++) {
        let code = '';
        for (let i = 2; i < frameCount(gw, gh); i++) code += bitValue(frameSpec(i, gw, gh), x, y);
        seen.add(code);
      }
    }
    expect(seen.size).toBe(gw * gh);
  });
  it('makes each inverse frame the exact complement of its pattern frame', () => {
    for (let i = 2; i < frameCount(13, 5); i += 2) {
      for (let c = 0; c < 13; c++) {
        expect(bitValue(frameSpec(i, 13, 5), c, c) + bitValue(frameSpec(i + 1, 13, 5), c, c)).toBe(1);
      }
    }
  });
});

/** Replays the fillRect calls onto a pixel grid so a frame can be checked cell by cell. */
class Painter implements ScanContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '';
  pixels: boolean[][];
  constructor(
    private w: number,
    private h: number,
  ) {
    this.pixels = Array.from({ length: h }, () => Array<boolean>(w).fill(false));
  }
  fillRect(x: number, y: number, w: number, h: number) {
    const on = this.fillStyle === '#fff';
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++) {
      for (let xx = Math.max(0, x); xx < Math.min(this.w, x + w); xx++) this.pixels[yy][xx] = on;
    }
  }
}

describe('drawScanFrame', () => {
  const pw = 70;
  const ph = 30;
  const gw = Math.ceil(pw / STEP_PX);
  const gh = Math.ceil(ph / STEP_PX);
  it('paints every cell of every frame with the colour bitValue says', () => {
    for (let i = 0; i < frameCount(gw, gh); i++) {
      const spec = frameSpec(i, gw, gh);
      const p = new Painter(pw, ph);
      drawScanFrame(p, spec, pw, ph, gw, gh);
      for (let cy = 0; cy < gh; cy++) {
        for (let cx = 0; cx < gw; cx++) {
          const px = Math.min(pw - 1, cx * STEP_PX + 1);
          const py = Math.min(ph - 1, cy * STEP_PX + 1);
          expect(p.pixels[py][px], `frame ${i} cell ${cx},${cy}`).toBe(bitValue(spec, cx, cy) === 1);
        }
      }
    }
  });
});

describe('parseFrameSpec', () => {
  it('accepts valid specs', () => {
    expect(parseFrameSpec({ kind: 'white' })).toEqual({ kind: 'white' });
    expect(parseFrameSpec({ kind: 'black', extra: 1 })).toEqual({ kind: 'black' });
    const bit: FrameSpec = { kind: 'bit', axis: 'y', bit: 2, bits: 3, inverted: true };
    expect(parseFrameSpec({ ...bit })).toEqual(bit);
  });
  it('rejects anything else', () => {
    for (const bad of [
      null,
      42,
      {},
      { kind: 'grey' },
      { kind: 'bit', axis: 'z', bit: 0, bits: 3, inverted: false },
      { kind: 'bit', axis: 'x', bit: 3, bits: 3, inverted: false },
      { kind: 'bit', axis: 'x', bit: -1, bits: 3, inverted: false },
      { kind: 'bit', axis: 'x', bit: 0.5, bits: 3, inverted: false },
      { kind: 'bit', axis: 'x', bit: 0, bits: 17, inverted: false },
      { kind: 'bit', axis: 'x', bit: 0, bits: 3, inverted: 1 },
    ]) {
      expect(parseFrameSpec(bad), JSON.stringify(bad)).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/calibrate/patterns.test.ts`
Expected: FAIL — `./patterns` not found.

- [ ] **Step 3: Implement**

`src/calibrate/patterns.ts`:
```ts
/** The projector shows the scan on a coarse grid of STEP_PX-pixel cells. */
export const STEP_PX = 4;
/** Time between painting a frame and the phone looking at it (a camera needs a few frames to see a change). */
export const SETTLE_MS = 200;
/** Camera frames averaged per scan frame, to cut noise. */
export const CAPTURE_FRAMES = 3;
const MAX_BITS = 16;

/** Bits needed to address `n` cells (at least 1). */
export function bitsFor(n: number): number {
  let bits = 1;
  while (2 ** bits < n) bits++;
  return bits;
}

export const grayCode = (i: number): number => (i ^ (i >>> 1)) >>> 0;

export function fromGray(g: number): number {
  let n = 0;
  for (let v = g >>> 0; v; v >>>= 1) n ^= v;
  return n >>> 0;
}

/** White, black, then a pattern and its inverse for every bit of x, then of y. */
export const frameCount = (gw: number, gh: number): number => 2 + 2 * bitsFor(gw) + 2 * bitsFor(gh);

/** What one scan frame shows. `bit` counts from the most significant bit (0). */
export type FrameSpec =
  | { kind: 'white' }
  | { kind: 'black' }
  | { kind: 'bit'; axis: 'x' | 'y'; bit: number; bits: number; inverted: boolean };

export function frameSpec(index: number, gw: number, gh: number): FrameSpec {
  if (!Number.isInteger(index) || index < 0 || index >= frameCount(gw, gh)) {
    throw new RangeError(`scan frame ${index} is out of range`);
  }
  if (index === 0) return { kind: 'white' };
  if (index === 1) return { kind: 'black' };
  const bx = bitsFor(gw);
  const by = bitsFor(gh);
  const j = index - 2;
  if (j < 2 * bx) return { kind: 'bit', axis: 'x', bit: j >> 1, bits: bx, inverted: (j & 1) === 1 };
  const k = j - 2 * bx;
  return { kind: 'bit', axis: 'y', bit: k >> 1, bits: by, inverted: (k & 1) === 1 };
}

/** 1 when cell (x, y) is lit in this frame. */
export function bitValue(spec: FrameSpec, x: number, y: number): 0 | 1 {
  if (spec.kind === 'white') return 1;
  if (spec.kind === 'black') return 0;
  const v = spec.axis === 'x' ? x : y;
  const b = (grayCode(v) >>> (spec.bits - 1 - spec.bit)) & 1;
  return (spec.inverted ? 1 - b : b) as 0 | 1;
}

/** The only drawing calls a scan frame uses, so a stand-in can test it without a canvas. */
export type ScanContext = Pick<CanvasRenderingContext2D, 'fillStyle' | 'fillRect'>;

/** Paint one frame over a `pw` x `ph` area whose grid is `gw` x `gh` cells. */
export function drawScanFrame(ctx: ScanContext, spec: FrameSpec, pw: number, ph: number, gw: number, gh: number): void {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, pw, ph);
  if (spec.kind === 'black') return;
  ctx.fillStyle = '#fff';
  if (spec.kind === 'white') {
    ctx.fillRect(0, 0, pw, ph);
    return;
  }
  const along = spec.axis === 'x' ? gw : gh;
  let c = 0;
  while (c < along) {
    if (bitValue(spec, c, c) === 0) {
      c++;
      continue;
    }
    let end = c + 1;
    while (end < along && bitValue(spec, end, end) === 1) end++;
    const from = c * STEP_PX;
    const to = Math.min(end * STEP_PX, spec.axis === 'x' ? pw : ph);
    if (spec.axis === 'x') ctx.fillRect(from, 0, to - from, ph);
    else ctx.fillRect(0, from, pw, to - from);
    c = end;
  }
}

/** Validate a spec that arrived over a channel. */
export function parseFrameSpec(raw: unknown): FrameSpec | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const d = raw as Record<string, unknown>;
  if (d.kind === 'white') return { kind: 'white' };
  if (d.kind === 'black') return { kind: 'black' };
  if (d.kind !== 'bit') return null;
  if (d.axis !== 'x' && d.axis !== 'y') return null;
  const { bit, bits, inverted } = d;
  if (typeof bit !== 'number' || typeof bits !== 'number' || !Number.isInteger(bit) || !Number.isInteger(bits)) return null;
  if (bits < 1 || bits > MAX_BITS || bit < 0 || bit >= bits) return null;
  if (typeof inverted !== 'boolean') return null;
  return { kind: 'bit', axis: d.axis, bit, bits, inverted };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/calibrate && npx tsc --noEmit && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/calibrate/patterns.ts src/calibrate/patterns.test.ts
git commit -m "feat(calibrate): Gray-code scan frames

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Decoding, with a simulated camera

**Files:**
- Create: `src/calibrate/synth.ts`, `src/calibrate/decode.ts`
- Test: `src/calibrate/decode.test.ts`

**Interfaces:**
- Consumes: `STEP_PX`, `bitValue`, `bitsFor`, `frameCount`, `frameSpec`, `fromGray` (Task 1); `computeHomography`, `applyHomographyChecked`, `Mat3` from `../warp/homography` (`computeHomography(src, dst)` returns the matrix that maps `src` points to `dst` points; `applyHomographyChecked(h, p)` returns the mapped point or null).
- Produces: `type GrayFrame = Uint8ClampedArray`; `interface ScanMap { width; height; gw; gh; mapX: Uint16Array; mapY: Uint16Array; mask: Uint8Array }`; `MIN_CONTRAST`, `MIN_BIT_MARGIN`; `decodeScan(frames, width, height, gw, gh, minContrast?, minMargin?): ScanMap`; test-support `synthScan(opts): { frames; projToCam; camToProj }`.

- [ ] **Step 1: Write the test support and the failing test**

`src/calibrate/synth.ts` (test support only; nothing in the app imports it):
```ts
import { applyHomographyChecked, computeHomography, type Mat3 } from '../warp/homography';
import type { Vec2 } from '../warp/types';
import type { GrayFrame } from './decode';
import { STEP_PX, bitValue, frameCount, frameSpec } from './patterns';

export interface SynthOptions {
  /** Projector size in pixels. */
  pw: number;
  ph: number;
  /** Camera size in pixels. */
  camW: number;
  camH: number;
  /** Four projector points and where the camera sees them (same order). */
  projCorners: Vec2[];
  camCorners: Vec2[];
  /** Peak noise in grey levels (uniform, +/-). */
  noise?: number;
  seed?: number;
  /** Lit, dark and unlit (ambient) grey levels. */
  hi?: number;
  lo?: number;
  ambient?: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Render every scan frame as a camera would see it through a known projector-to-camera mapping. */
export function synthScan(o: SynthOptions): { frames: GrayFrame[]; projToCam: Mat3; camToProj: Mat3 } {
  const projToCam = computeHomography(o.projCorners, o.camCorners);
  const camToProj = computeHomography(o.camCorners, o.projCorners);
  if (!projToCam || !camToProj) throw new Error('synthScan: degenerate corners');
  const gw = Math.ceil(o.pw / STEP_PX);
  const gh = Math.ceil(o.ph / STEP_PX);
  const hi = o.hi ?? 210;
  const lo = o.lo ?? 40;
  const ambient = o.ambient ?? 30;
  const noise = o.noise ?? 0;
  const rand = mulberry32(o.seed ?? 1);
  // Which projector cell each camera pixel sees (or -1 for outside the projector image).
  const cellOf = new Int32Array(o.camW * o.camH * 2).fill(-1);
  for (let y = 0; y < o.camH; y++) {
    for (let x = 0; x < o.camW; x++) {
      const q = applyHomographyChecked(camToProj, [x + 0.5, y + 0.5]);
      if (!q || q[0] < 0 || q[1] < 0 || q[0] >= o.pw || q[1] >= o.ph) continue;
      const i = (y * o.camW + x) * 2;
      cellOf[i] = Math.min(gw - 1, Math.floor(q[0] / STEP_PX));
      cellOf[i + 1] = Math.min(gh - 1, Math.floor(q[1] / STEP_PX));
    }
  }
  const frames: GrayFrame[] = [];
  for (let f = 0; f < frameCount(gw, gh); f++) {
    const spec = frameSpec(f, gw, gh);
    const out = new Uint8ClampedArray(o.camW * o.camH);
    for (let p = 0; p < out.length; p++) {
      const cx = cellOf[p * 2];
      const base = cx < 0 ? ambient : bitValue(spec, cx, cellOf[p * 2 + 1]) === 1 ? hi : lo;
      out[p] = Math.round(base + (rand() * 2 - 1) * noise);
    }
    frames.push(out);
  }
  return { frames, projToCam, camToProj };
}
```

`src/calibrate/decode.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { MIN_CONTRAST, decodeScan } from './decode';
import { STEP_PX, bitsFor, frameCount } from './patterns';
import { synthScan } from './synth';
import type { Vec2 } from '../warp/types';

const rect = (w: number, h: number): Vec2[] => [
  [0, 0],
  [w, 0],
  [w, h],
  [0, h],
];

describe('decodeScan', () => {
  it('reads every cell exactly when the camera sees the projector 1:1', () => {
    const pw = 64;
    const ph = 32;
    const { frames } = synthScan({ pw, ph, camW: pw, camH: ph, projCorners: rect(pw, ph), camCorners: rect(pw, ph) });
    const gw = pw / STEP_PX;
    const gh = ph / STEP_PX;
    const map = decodeScan(frames, pw, ph, gw, gh);
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const p = y * pw + x;
        expect(map.mask[p]).toBe(1);
        expect(map.mapX[p]).toBe(Math.floor(x / STEP_PX));
        expect(map.mapY[p]).toBe(Math.floor(y / STEP_PX));
      }
    }
  });

  it('masks the camera pixels that do not see the projector', () => {
    const pw = 64;
    const ph = 32;
    const camCorners: Vec2[] = [
      [16, 8],
      [80, 8],
      [80, 40],
      [16, 40],
    ];
    const { frames } = synthScan({ pw, ph, camW: 96, camH: 48, projCorners: rect(pw, ph), camCorners });
    const map = decodeScan(frames, 96, 48, pw / STEP_PX, ph / STEP_PX);
    let lit = 0;
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 96; x++) {
        const inside = x >= 16 && x < 80 && y >= 8 && y < 40;
        const p = y * 96 + x;
        expect(map.mask[p], `pixel ${x},${y}`).toBe(inside ? 1 : 0);
        if (inside) {
          lit++;
          expect(map.mapX[p]).toBe(Math.floor((x - 16) / STEP_PX));
          expect(map.mapY[p]).toBe(Math.floor((y - 8) / STEP_PX));
        }
      }
    }
    expect(lit).toBe(64 * 32);
  });

  it('decodes a grid that is not a power of two', () => {
    const pw = 52;
    const ph = 20;
    const { frames } = synthScan({ pw, ph, camW: pw, camH: ph, projCorners: rect(pw, ph), camCorners: rect(pw, ph) });
    const map = decodeScan(frames, pw, ph, 13, 5);
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        expect(map.mask[y * pw + x]).toBe(1);
        expect(map.mapX[y * pw + x]).toBe(Math.floor(x / STEP_PX));
        expect(map.mapY[y * pw + x]).toBe(Math.floor(y / STEP_PX));
      }
    }
  });

  it('masks codes that fall outside the grid instead of clamping them', () => {
    // Frames were made for a 16-cell-wide grid but decoded as if it had 13 cells.
    const pw = 64;
    const ph = 20;
    const { frames } = synthScan({ pw, ph, camW: pw, camH: ph, projCorners: rect(pw, ph), camCorners: rect(pw, ph) });
    expect(bitsFor(13)).toBe(bitsFor(16));
    const map = decodeScan(frames, pw, ph, 13, 5);
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        expect(map.mask[y * pw + x], `pixel ${x},${y}`).toBe(Math.floor(x / STEP_PX) < 13 ? 1 : 0);
      }
    }
  });

  it('still decodes exactly with +/-8 grey levels of noise', () => {
    const pw = 64;
    const ph = 32;
    const { frames } = synthScan({ pw, ph, camW: pw, camH: ph, projCorners: rect(pw, ph), camCorners: rect(pw, ph), noise: 8, seed: 7 });
    const map = decodeScan(frames, pw, ph, pw / STEP_PX, ph / STEP_PX);
    for (let y = 0; y < ph; y++) {
      for (let x = 0; x < pw; x++) {
        const p = y * pw + x;
        expect(map.mask[p]).toBe(1);
        expect(map.mapX[p]).toBe(Math.floor(x / STEP_PX));
        expect(map.mapY[p]).toBe(Math.floor(y / STEP_PX));
      }
    }
  });

  it('marks a pixel unreliable when a bit comparison is too close to call', () => {
    const pw = 16;
    const ph = 8;
    const { frames } = synthScan({ pw, ph, camW: pw, camH: ph, projCorners: rect(pw, ph), camCorners: rect(pw, ph) });
    // Make pixel 0 read the same in an x-bit pattern frame and its inverse.
    frames[2][0] = 100;
    frames[3][0] = 100;
    const map = decodeScan(frames, pw, ph, 4, 2);
    expect(map.mask[0]).toBe(0);
    expect(map.mask[1]).toBe(1);
  });

  it('treats a pixel as unlit when white is not clearly brighter than black', () => {
    const pw = 16;
    const ph = 8;
    const { frames } = synthScan({ pw, ph, camW: pw, camH: ph, projCorners: rect(pw, ph), camCorners: rect(pw, ph) });
    frames[0][5] = 100;
    frames[1][5] = 100 - (MIN_CONTRAST - 1);
    const map = decodeScan(frames, pw, ph, 4, 2);
    expect(map.mask[5]).toBe(0);
  });

  it('refuses frame lists of the wrong size', () => {
    const pw = 16;
    const ph = 8;
    const { frames } = synthScan({ pw, ph, camW: pw, camH: ph, projCorners: rect(pw, ph), camCorners: rect(pw, ph) });
    expect(frames.length).toBe(frameCount(4, 2));
    expect(() => decodeScan(frames.slice(1), pw, ph, 4, 2)).toThrow();
    expect(() => decodeScan(frames, pw + 1, ph, 4, 2)).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/calibrate/decode.test.ts`
Expected: FAIL — `./decode` not found.

- [ ] **Step 3: Implement**

`src/calibrate/decode.ts`:
```ts
import { bitsFor, frameCount, fromGray } from './patterns';

/** One camera frame as grey levels (width * height). */
export type GrayFrame = Uint8ClampedArray;

/** For every camera pixel: which projector grid cell lit it. `mask` is 1 where that is reliable. */
export interface ScanMap {
  width: number;
  height: number;
  gw: number;
  gh: number;
  mapX: Uint16Array;
  mapY: Uint16Array;
  mask: Uint8Array;
}

/** A camera pixel is lit when white is at least this much brighter than black. */
export const MIN_CONTRAST = 40;
/** A stripe bit is only trusted when its pattern and inverse frames differ by at least this much. */
export const MIN_BIT_MARGIN = 12;

export function decodeScan(
  frames: GrayFrame[],
  width: number,
  height: number,
  gw: number,
  gh: number,
  minContrast = MIN_CONTRAST,
  minMargin = MIN_BIT_MARGIN,
): ScanMap {
  const total = frameCount(gw, gh);
  if (frames.length !== total) throw new Error(`expected ${total} scan frames, got ${frames.length}`);
  const size = width * height;
  for (const f of frames) if (f.length !== size) throw new Error('scan frame has the wrong size');
  const bx = bitsFor(gw);
  const by = bitsFor(gh);
  const mapX = new Uint16Array(size);
  const mapY = new Uint16Array(size);
  const mask = new Uint8Array(size);
  const white = frames[0];
  const black = frames[1];
  for (let p = 0; p < size; p++) {
    if (white[p] - black[p] < minContrast) continue;
    let ok = true;
    let gx = 0;
    for (let k = 0; k < bx && ok; k++) {
      const pat = frames[2 + 2 * k][p];
      const inv = frames[3 + 2 * k][p];
      if (Math.abs(pat - inv) < minMargin) ok = false;
      gx = (gx << 1) | (pat > inv ? 1 : 0);
    }
    let gy = 0;
    for (let k = 0; k < by && ok; k++) {
      const pat = frames[2 + 2 * bx + 2 * k][p];
      const inv = frames[3 + 2 * bx + 2 * k][p];
      if (Math.abs(pat - inv) < minMargin) ok = false;
      gy = (gy << 1) | (pat > inv ? 1 : 0);
    }
    if (!ok) continue;
    const cx = fromGray(gx);
    const cy = fromGray(gy);
    if (cx >= gw || cy >= gh) continue;
    mapX[p] = cx;
    mapY[p] = cy;
    mask[p] = 1;
  }
  return { width, height, gw, gh, mapX, mapY, mask };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/calibrate && npx tsc --noEmit && npm test`
Expected: PASS. If `computeHomography` maps the other way round from the assumption in the Interfaces block, the "masks the camera pixels" test will fail: swap the two arguments in `synth.ts` (not the tests) and report it.

- [ ] **Step 5: Commit**

```bash
git add src/calibrate/synth.ts src/calibrate/decode.ts src/calibrate/decode.test.ts
git commit -m "feat(calibrate): decode scans into a camera-to-projector map

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Corners from taps

**Files:**
- Create: `src/calibrate/corners.ts`
- Test: `src/calibrate/corners.test.ts`

**Interfaces:**
- Consumes: `ScanMap` (Task 2), `STEP_PX` (Task 1), `Corners`, `Vec2`, `isValidQuad`, `Surface`, `synthScan` (tests only).
- Produces: `TAP_RADIUS_PX`, `projectorPointAt(map, cx, cy, radius?, minValid?): Vec2 | null`, `type TapResult`, `tapsToCorners(map, taps, projector): TapResult`, `applyCalibration(surfaces, results): Surface[]`, `tapToCamera(clientX, clientY, rect, camW, camH): Vec2 | null`.

- [ ] **Step 1: Write the failing test**

`src/calibrate/corners.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { applyHomographyChecked } from '../warp/homography';
import { isValidQuad } from '../warp/quad';
import type { Surface } from '../surfaces/types';
import { parseSurfaceList } from '../surfaces/parse';
import type { Vec2 } from '../warp/types';
import { STEP_PX } from './patterns';
import { decodeScan, type ScanMap } from './decode';
import { applyCalibration, projectorPointAt, tapToCamera, tapsToCorners } from './corners';
import { synthScan } from './synth';

const rect = (w: number, h: number): Vec2[] => [
  [0, 0],
  [w, 0],
  [w, h],
  [0, h],
];

/** A hand-made map: mapX = x, mapY = 2 * y over the whole image, every pixel reliable. */
function linearMap(width: number, height: number): ScanMap {
  const n = width * height;
  const mapX = new Uint16Array(n);
  const mapY = new Uint16Array(n);
  const mask = new Uint8Array(n).fill(1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      mapX[y * width + x] = x;
      mapY[y * width + x] = 2 * y;
    }
  }
  return { width, height, gw: 1000, gh: 1000, mapX, mapY, mask };
}

describe('projectorPointAt', () => {
  it('recovers an exactly linear map', () => {
    // Pixel centres: value = (xc - 0.5) cells, so at the tap (10.5, 7.5) mapX = 10 and mapY = 14.
    const p = projectorPointAt(linearMap(40, 30), 10.5, 7.5);
    expect(p).not.toBeNull();
    expect(p![0]).toBeCloseTo((10 + 0.5) * STEP_PX, 6);
    expect(p![1]).toBeCloseTo((14 + 0.5) * STEP_PX, 6);
  });

  it('works within 1 px on a real decoded scan', () => {
    const pw = 64;
    const ph = 32;
    const { frames } = synthScan({ pw, ph, camW: pw, camH: ph, projCorners: rect(pw, ph), camCorners: rect(pw, ph) });
    const map = decodeScan(frames, pw, ph, pw / STEP_PX, ph / STEP_PX);
    const p = projectorPointAt(map, 30.3, 14.7);
    expect(p).not.toBeNull();
    expect(Math.abs(p![0] - 30.3)).toBeLessThan(1);
    expect(Math.abs(p![1] - 14.7)).toBeLessThan(1);
  });

  it('refuses a tap on an unlit region', () => {
    const map = linearMap(40, 30);
    map.mask.fill(0);
    expect(projectorPointAt(map, 20, 15)).toBeNull();
  });

  it('refuses a tap where fewer than half of the disc is lit', () => {
    const map = linearMap(40, 30);
    for (let y = 0; y < 30; y++) for (let x = 0; x < 40; x++) if (x > 18) map.mask[y * 40 + x] = 0;
    // The tap sits at x = 20: only the left ~40% of the disc is lit.
    expect(projectorPointAt(map, 22, 15)).toBeNull();
  });

  it('refuses when fewer than 6 reliable pixels are available', () => {
    const map = linearMap(40, 30);
    map.mask.fill(0);
    for (let i = 0; i < 4; i++) map.mask[15 * 40 + 20 + i] = 1;
    expect(projectorPointAt(map, 21, 15.5, 1.5, 0.01)).toBeNull();
  });

  it('refuses non-finite taps', () => {
    expect(projectorPointAt(linearMap(40, 30), NaN, 5)).toBeNull();
  });
});

describe('tapsToCorners', () => {
  const pw = 128;
  const ph = 72;
  const camCorners: Vec2[] = [
    [8, 6],
    [184, 12],
    [178, 102],
    [4, 98],
  ];
  const scan = synthScan({ pw, ph, camW: 192, camH: 108, projCorners: rect(pw, ph), camCorners });
  const map = decodeScan(scan.frames, 192, 108, pw / STEP_PX, ph / STEP_PX);
  const truth: Vec2[] = [
    [20, 10],
    [100, 10],
    [100, 60],
    [20, 60],
  ];
  const tapsFor = (pts: Vec2[]): Vec2[] => pts.map((q) => applyHomographyChecked(scan.projToCam, q)!);

  it('recovers known projector corners through a perspective camera within 1 px', () => {
    const r = tapsToCorners(map, tapsFor(truth) as [Vec2, Vec2, Vec2, Vec2], { w: pw, h: ph });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const got = [r.corners.tl, r.corners.tr, r.corners.br, r.corners.bl];
    got.forEach((c, i) => {
      expect(Math.abs(c[0] * pw - truth[i][0]), `corner ${i} x`).toBeLessThan(1);
      expect(Math.abs(c[1] * ph - truth[i][1]), `corner ${i} y`).toBeLessThan(1);
    });
    expect(isValidQuad(r.corners)).toBe(true);
  });

  it('refuses taps given in the wrong order (a bow-tie)', () => {
    const swapped = tapsFor([truth[0], truth[2], truth[1], truth[3]]) as [Vec2, Vec2, Vec2, Vec2];
    const r = tapsToCorners(map, swapped, { w: pw, h: ph });
    expect(r).toEqual({ ok: false, failed: [], reason: 'invalid-quad' });
  });

  it('names the taps that landed on an unlit spot', () => {
    const taps = tapsFor(truth) as [Vec2, Vec2, Vec2, Vec2];
    taps[2] = [2, 2]; // outside the projected image in the camera
    const r = tapsToCorners(map, taps, { w: pw, h: ph });
    expect(r).toEqual({ ok: false, failed: [2], reason: 'unlit' });
  });
});

describe('applyCalibration', () => {
  const list: Surface[] = [
    { id: 'a', corners: { tl: [0, 0], tr: [1, 0], br: [1, 1], bl: [0, 1] }, srcRect: { u0: 0, v0: 0, u1: 0.5, v1: 1 } },
    { id: 'b', corners: { tl: [0.1, 0.1], tr: [0.9, 0.1], br: [0.9, 0.9], bl: [0.1, 0.9] }, srcRect: { u0: 0.5, v0: 0, u1: 1, v1: 1 } },
  ];
  const fresh = { tl: [0.2, 0.2] as Vec2, tr: [0.8, 0.2] as Vec2, br: [0.8, 0.8] as Vec2, bl: [0.2, 0.8] as Vec2 };

  it('replaces only the corners of the faces given', () => {
    const out = applyCalibration(list, { b: fresh });
    expect(out[0]).toBe(list[0]);
    expect(out[1].corners).toEqual(fresh);
    expect(out[1].srcRect).toEqual(list[1].srcRect);
    expect(out[1].id).toBe('b');
  });
  it('copies the corner tuples so later edits to the input cannot leak in', () => {
    const out = applyCalibration(list, { b: fresh });
    expect(out[1].corners.tl).not.toBe(fresh.tl);
  });
  it('ignores unknown ids and returns a list the shared parser accepts', () => {
    const out = applyCalibration(list, { zzz: fresh, a: fresh });
    expect(out.map((s) => s.id)).toEqual(['a', 'b']);
    expect(parseSurfaceList(out)).not.toBeNull();
  });
  it('does not modify its input', () => {
    const before = JSON.stringify(list);
    applyCalibration(list, { a: fresh });
    expect(JSON.stringify(list)).toBe(before);
  });
});

describe('tapToCamera', () => {
  const rect2 = { left: 100, top: 50, width: 320, height: 180 };
  it('maps a click inside the shown picture to camera pixels', () => {
    expect(tapToCamera(260, 140, rect2, 640, 360)).toEqual([320, 180]);
    expect(tapToCamera(100, 50, rect2, 640, 360)).toEqual([0, 0]);
  });
  it('refuses clicks outside the picture and degenerate rectangles', () => {
    expect(tapToCamera(99, 100, rect2, 640, 360)).toBeNull();
    expect(tapToCamera(200, 231, rect2, 640, 360)).toBeNull();
    expect(tapToCamera(5, 5, { left: 0, top: 0, width: 0, height: 10 }, 640, 360)).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/calibrate/corners.test.ts`
Expected: FAIL — `./corners` not found.

- [ ] **Step 3: Implement**

`src/calibrate/corners.ts`:
```ts
import { isValidQuad } from '../warp/quad';
import type { Corners, Vec2 } from '../warp/types';
import type { Surface } from '../surfaces/types';
import type { ScanMap } from './decode';
import { STEP_PX } from './patterns';

/** Camera pixels (of the analysis image) around a tap that are used to read the projector position. */
export const TAP_RADIUS_PX = 8;

/** Solve for `a` in z = a + b*dx + c*dy by least squares. Returns null when the points are collinear. */
function planeAtOrigin(
  n: number,
  sx: number,
  sy: number,
  sxx: number,
  sxy: number,
  syy: number,
  sz: number,
  sxz: number,
  syz: number,
): number | null {
  // Cramer's rule on [[n,sx,sy],[sx,sxx,sxy],[sy,sxy,syy]] * [a,b,c] = [sz,sxz,syz].
  const det3 = (m: number[][]) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const det = det3([
    [n, sx, sy],
    [sx, sxx, sxy],
    [sy, sxy, syy],
  ]);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-6) return null;
  const detA = det3([
    [sz, sx, sy],
    [sxz, sxx, sxy],
    [syz, sxy, syy],
  ]);
  return detA / det;
}

/**
 * The projector pixel a camera tap lands on: a plane is fitted to the decoded cells around the tap
 * (which smooths the 4-pixel steps) and read off at the tap. Null when too little of the disc around
 * the tap is reliably lit.
 */
export function projectorPointAt(map: ScanMap, cx: number, cy: number, radius = TAP_RADIUS_PX, minValid = 0.5): Vec2 | null {
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(map.width - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(map.height - 1, Math.ceil(cy + radius));
  let total = 0;
  let n = 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  let szx = 0;
  let sxzx = 0;
  let syzx = 0;
  let szy = 0;
  let sxzy = 0;
  let syzy = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      total++;
      const p = y * map.width + x;
      if (!map.mask[p]) continue;
      n++;
      sx += dx;
      sy += dy;
      sxx += dx * dx;
      sxy += dx * dy;
      syy += dy * dy;
      const zx = map.mapX[p];
      const zy = map.mapY[p];
      szx += zx;
      sxzx += dx * zx;
      syzx += dy * zx;
      szy += zy;
      sxzy += dx * zy;
      syzy += dy * zy;
    }
  }
  if (total === 0 || n < 6 || n / total < minValid) return null;
  const ax = planeAtOrigin(n, sx, sy, sxx, sxy, syy, szx, sxzx, syzx);
  const ay = planeAtOrigin(n, sx, sy, sxx, sxy, syy, szy, sxzy, syzy);
  if (ax === null || ay === null) return null;
  return [(ax + 0.5) * STEP_PX, (ay + 0.5) * STEP_PX];
}

export type TapResult =
  | { ok: true; corners: Corners }
  | { ok: false; failed: number[]; reason: 'unlit' | 'invalid-quad' };

/**
 * Four camera taps (tl, tr, br, bl) to a face's corners in unit space. `failed` names the taps that
 * could not be read (reason 'unlit'); when all four read but the quad is bent or collapsed the reason
 * is 'invalid-quad' and `failed` is empty.
 */
export function tapsToCorners(map: ScanMap, taps: [Vec2, Vec2, Vec2, Vec2], projector: { w: number; h: number }): TapResult {
  const points: Vec2[] = [];
  const failed: number[] = [];
  taps.forEach((t, i) => {
    const p = projectorPointAt(map, t[0], t[1]);
    if (p) points.push([p[0] / projector.w, p[1] / projector.h]);
    else failed.push(i);
  });
  if (failed.length > 0) return { ok: false, failed, reason: 'unlit' };
  const corners: Corners = { tl: points[0], tr: points[1], br: points[2], bl: points[3] };
  if (!isValidQuad(corners)) return { ok: false, failed: [], reason: 'invalid-quad' };
  return { ok: true, corners };
}

/** Replace the corners of the faces in `results`; everything else (other faces, slices, ids) is untouched. */
export function applyCalibration(surfaces: Surface[], results: Record<string, Corners>): Surface[] {
  return surfaces.map((s) => {
    const c = Object.prototype.hasOwnProperty.call(results, s.id) ? results[s.id] : undefined;
    if (!c) return s;
    return { ...s, corners: { tl: [...c.tl], tr: [...c.tr], br: [...c.br], bl: [...c.bl] } };
  });
}

/** A click on the shown camera picture to camera analysis pixels; null outside the picture. */
export function tapToCamera(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  camW: number,
  camH: number,
): Vec2 | null {
  if (!(rect.width > 0) || !(rect.height > 0)) return null;
  const u = (clientX - rect.left) / rect.width;
  const v = (clientY - rect.top) / rect.height;
  if (!(u >= 0 && u <= 1 && v >= 0 && v <= 1)) return null;
  return [u * camW, v * camH];
}
```
Note `applyCalibration`'s copy uses `[...c.tl]` typed as `number[]`; if tsc objects, write `[c.tl[0], c.tl[1]]` (and the same for the others) instead.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/calibrate && npx tsc --noEmit && npm test`
Expected: PASS. The 1 px accuracy tests (real decoded scans) are the important ones: if either fails, report the measured error (print it) and do NOT loosen the tolerance above 2 px without reporting.

- [ ] **Step 5: Commit**

```bash
git add src/calibrate/corners.ts src/calibrate/corners.test.ts
git commit -m "feat(calibrate): turn camera taps into face corners

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Messages, mailbox and relay (the server side)

**Files:**
- Create: `src/calibrate/protocol.ts`, `src/calibrate/mailbox.ts`, `src/calibrate/relay-handler.ts`, `tools/calibration-relay.ts`
- Modify: `vite.config.ts`
- Test: `src/calibrate/protocol.test.ts`, `src/calibrate/mailbox.test.ts`, `src/calibrate/relay-handler.test.ts`

**Interfaces:**
- Consumes: `ScanMap` (Task 2).
- Produces:
  - protocol: `MAX_BODY_CHARS`, `toBase64`, `fromBase64`, `encodeU16`, `decodeU16`, `type LaptopMsg`, `type PhoneMsg`, `type CalibMsg`, `encodeCalibMsg(msg): string`, `parseCalibMsg(text: unknown): CalibMsg | null`. Messages: laptop→phone `{type:'show',frame,of}`, `{type:'scan-start',gw,gh}`, `{type:'scan-cancel'}`; phone→laptop `{type:'hello',width,height}`, `{type:'ready'}`, `{type:'frame-done',frame}`, `{type:'scan-result',map: ScanMap,preview: string}`, `{type:'error',reason: 'moved'|'camera'|'timeout'|'dark'|'other',detail?: string}`.
  - mailbox: `createMailbox(clock?)` with `post(session, box, body): 'ok' | 'bad' | 'too-big' | 'full'`, `after(session, box, afterSeq): { seq: number; body: string }[]`; `type Box = 'to-phone' | 'to-laptop'`.
  - relay-handler: `handleCalibRequest(mailbox, req: { method: string; url: string; body: string }, lanAddresses: string[]): { status: number; json: unknown }`.
  - plugin: `calibrationRelay(): Plugin`.

- [ ] **Step 1: Write the failing tests**

`src/calibrate/protocol.test.ts`:
```ts
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
```

`src/calibrate/mailbox.test.ts`:
```ts
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
});
```

`src/calibrate/relay-handler.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { createMailbox } from './mailbox';
import { handleCalibRequest } from './relay-handler';

const S = 'f'.repeat(32);
const lan = ['192.168.1.20'];
const req = (method: string, url: string, body = '') => ({ method, url, body });

describe('handleCalibRequest', () => {
  it('posts then reads a message', () => {
    const mb = createMailbox(() => 0);
    expect(handleCalibRequest(mb, req('POST', `/calib/${S}/to-phone`, 'hi'), lan)).toEqual({ status: 200, json: { ok: true } });
    const r = handleCalibRequest(mb, req('GET', `/calib/${S}/to-phone?after=0`), lan);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ messages: [{ body: 'hi' }] });
  });
  it('treats a missing or bad after as 0', () => {
    const mb = createMailbox(() => 0);
    handleCalibRequest(mb, req('POST', `/calib/${S}/to-laptop`, 'yo'), lan);
    for (const q of ['', '?after=abc', '?after=-5']) {
      const r = handleCalibRequest(mb, req('GET', `/calib/${S}/to-laptop${q}`), lan);
      expect(r.json).toMatchObject({ messages: [{ body: 'yo' }] });
    }
  });
  it('answers /calib/info with the LAN addresses', () => {
    expect(handleCalibRequest(createMailbox(() => 0), req('GET', '/calib/info'), lan)).toEqual({ status: 200, json: { addresses: lan } });
  });
  it('refuses paths that do not match, wrong methods and oversize bodies', () => {
    const mb = createMailbox(() => 0);
    expect(handleCalibRequest(mb, req('GET', '/calib/short/to-phone'), lan).status).toBe(404);
    expect(handleCalibRequest(mb, req('GET', `/calib/${S}/elsewhere`), lan).status).toBe(404);
    expect(handleCalibRequest(mb, req('GET', `/calib/${S}/to-phone/extra`), lan).status).toBe(404);
    expect(handleCalibRequest(mb, req('GET', '/other'), lan).status).toBe(404);
    expect(handleCalibRequest(mb, req('DELETE', `/calib/${S}/to-phone`), lan).status).toBe(405);
    expect(handleCalibRequest(mb, req('POST', `/calib/${S}/to-phone`, 'x'.repeat(4_000_001)), lan).status).toBe(413);
  });
  it('answers 429 when there are too many sessions', () => {
    const mb = createMailbox(() => 0);
    for (const c of 'abcd') handleCalibRequest(mb, req('POST', `/calib/${c.repeat(32)}/to-phone`, 'x'), lan);
    expect(handleCalibRequest(mb, req('POST', `/calib/${'e'.repeat(32)}/to-phone`, 'x'), lan).status).toBe(429);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/calibrate/protocol.test.ts src/calibrate/mailbox.test.ts src/calibrate/relay-handler.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`src/calibrate/protocol.ts`:
```ts
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
```

`src/calibrate/mailbox.ts`:
```ts
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
}

const isBox = (b: unknown): b is Box => b === 'to-phone' || b === 'to-laptop';

/** An in-memory message mailbox for one laptop and one phone, with hard caps. */
export function createMailbox(clock: () => number = Date.now): Mailbox {
  const sessions = new Map<string, Session>();
  let counter = 0;

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
  };
}
```

`src/calibrate/relay-handler.ts`:
```ts
import { createMailbox, type Box, type Mailbox } from './mailbox';
import { MAX_BODY_CHARS } from './protocol';

export interface RelayRequest {
  method: string;
  url: string;
  body: string;
}
export interface RelayResponse {
  status: number;
  json: unknown;
}

const PATH = /^\/calib\/([0-9a-f]{32})\/(to-phone|to-laptop)$/;

/** Everything the relay does, as a pure function of the request. The Vite plugin only adapts Node to this. */
export function handleCalibRequest(mailbox: Mailbox, req: RelayRequest, lanAddresses: string[]): RelayResponse {
  const url = new URL(req.url, 'http://relay.invalid');
  if (url.pathname === '/calib/info') {
    return req.method === 'GET' ? { status: 200, json: { addresses: lanAddresses } } : { status: 405, json: { error: 'method' } };
  }
  const m = PATH.exec(url.pathname);
  if (!m) return { status: 404, json: { error: 'not found' } };
  const session = m[1];
  const box = m[2] as Box;
  if (req.method === 'POST') {
    if (req.body.length > MAX_BODY_CHARS) return { status: 413, json: { error: 'too big' } };
    const r = mailbox.post(session, box, req.body);
    if (r === 'ok') return { status: 200, json: { ok: true } };
    if (r === 'full') return { status: 429, json: { error: 'too many sessions' } };
    if (r === 'too-big') return { status: 413, json: { error: 'too big' } };
    return { status: 400, json: { error: 'bad request' } };
  }
  if (req.method === 'GET') {
    const raw = Number(url.searchParams.get('after') ?? '0');
    const after = Number.isFinite(raw) && raw > 0 ? raw : 0;
    return { status: 200, json: { messages: mailbox.after(session, box, after) } };
  }
  return { status: 405, json: { error: 'method' } };
}

export { createMailbox };
```

`tools/calibration-relay.ts` (outside the `src` tsconfig include; Vite loads it when it loads the config, so it is not type-checked by `tsc` — keep it simple and read it carefully):
```ts
import os from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { createMailbox } from '../src/calibrate/mailbox';
import { MAX_BODY_CHARS } from '../src/calibrate/protocol';
import { handleCalibRequest } from '../src/calibrate/relay-handler';

const POLL_MS = 250;
const LONG_POLL_MS = 20_000;

function lanAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list ?? []) if (i.family === 'IPv4' && !i.internal) out.push(i.address);
  }
  return out;
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve) => {
    let body = '';
    let tooBig = false;
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      if (tooBig) return;
      body += chunk;
      if (body.length > MAX_BODY_CHARS) {
        tooBig = true;
        body = '';
      }
    });
    req.on('end', () => resolve(tooBig ? null : body));
    req.on('error', () => resolve(null));
  });
}

function send(res: ServerResponse, status: number, json: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(json));
}

/** Hosts the laptop <-> phone mailbox inside the dev and preview servers (LAN use only, in memory). */
export function calibrationRelay(): Plugin {
  const mailbox = createMailbox();
  type Mw = { use(fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void): void };
  const attach = (middlewares: Mw) => {
    middlewares.use((req, res, next) => {
      const url = req.url ?? '';
      if (!url.startsWith('/calib/')) return next();
      const method = req.method ?? 'GET';
      void (async () => {
        const body = method === 'POST' ? await readBody(req) : '';
        if (body === null) return send(res, 413, { error: 'too big' });
        const run = () => handleCalibRequest(mailbox, { method, url, body }, lanAddresses());
        let r = run();
        if (method === 'GET' && r.status === 200 && Array.isArray((r.json as { messages?: unknown }).messages)) {
          // Long poll: wait for a message, up to 20 s, giving up if the client goes away.
          let closed = false;
          res.on('close', () => (closed = true));
          const until = Date.now() + LONG_POLL_MS;
          while ((r.json as { messages: unknown[] }).messages.length === 0 && Date.now() < until && !closed) {
            await new Promise((resolve) => setTimeout(resolve, POLL_MS));
            r = run();
          }
          if (closed) return;
        }
        send(res, r.status, r.json);
      })();
    });
  };
  return {
    name: 'hypermapping-calibration-relay',
    configureServer(server) {
      attach(server.middlewares as unknown as Mw);
    },
    configurePreviewServer(server) {
      attach(server.middlewares as unknown as Mw);
    },
  };
}
```

`vite.config.ts` — add the import and plugin (keep everything else):
```ts
import { calibrationRelay } from './tools/calibration-relay';
// ...
plugins: [react(), basicSsl(), calibrationRelay()],
```
and add `camera: fileURLToPath(new URL('./camera.html', import.meta.url)),` to `rollupOptions.input` ONLY in Task 6 (when `camera.html` exists; adding it earlier breaks the build).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/calibrate && npx tsc --noEmit && npm test && npm run build`
Expected: PASS and the build succeeds (the plugin loads with the config). If `tsc` objects to `relay-handler.ts` re-exporting `createMailbox`, remove that last line and the import it needs.

- [ ] **Step 5: Commit**

```bash
git add src/calibrate/protocol.ts src/calibrate/protocol.test.ts src/calibrate/mailbox.ts src/calibrate/mailbox.test.ts src/calibrate/relay-handler.ts src/calibrate/relay-handler.test.ts tools/calibration-relay.ts vite.config.ts
git commit -m "feat(calibrate): messages, in-memory mailbox and the dev/preview relay

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Small helpers (scan driver, luma, steadiness, link, QR, relay client)

**Files:**
- Create: `src/calibrate/scan-driver.ts`, `src/calibrate/luma.ts`, `src/calibrate/steady.ts`, `src/calibrate/link.ts`, `src/calibrate/qr.ts`, `src/calibrate/relay-client.ts`
- Modify: `package.json`, `package-lock.json` (one new dependency)
- Test: `src/calibrate/scan-driver.test.ts`, `src/calibrate/luma.test.ts`, `src/calibrate/steady.test.ts`, `src/calibrate/link.test.ts`, `src/calibrate/qr.test.ts`

**Interfaces:**
- Produces:
  - `runScan(total, deps: ScanDeps, signal: { cancelled: boolean }): Promise<'done' | 'cancelled'>` with `ScanDeps { showFrame(i): void | Promise<void>; settle(): Promise<void>; capture(i): Promise<void>; onProgress?(done, total): void }`.
  - `accumulateLuma(rgba: Uint8ClampedArray, acc: Uint16Array): void`, `finishLuma(acc: Uint16Array, count: number): Uint8ClampedArray`.
  - `MOTION_LIMITS`, `magnitude(a, b, c)`, `isMoving(sample, limits?)`.
  - `newSessionId(fill?)`, `buildCameraLink(host, port, protocol, session)`.
  - `qrPath(text): { size: number; d: string }`.
  - `createRelayClient(session, role, fetchFn?): RelayClient` with `send(text): Promise<boolean>`, `onMessage(fn)`, `close()`.

- [ ] **Step 1: Install the QR dependency**

Run: `npm view qrcode-generator version` then `npm install --save-exact qrcode-generator@<that version>`. Confirm `node_modules/qrcode-generator` ships a type declaration (a `.d.ts` file); if it does not, create `src/types/qrcode-generator.d.ts` declaring `export default function qrcode(typeNumber: number, errorCorrectionLevel: 'L' | 'M' | 'Q' | 'H'): { addData(data: string): void; make(): void; getModuleCount(): number; isDark(row: number, col: number): boolean }` as a module. Report the version installed.

- [ ] **Step 2: Write the failing tests**

`src/calibrate/scan-driver.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { runScan } from './scan-driver';

function recorder() {
  const log: string[] = [];
  return {
    log,
    deps: {
      showFrame: (i: number) => void log.push(`show${i}`),
      settle: async () => void log.push('settle'),
      capture: async (i: number) => void log.push(`capture${i}`),
      onProgress: (d: number, t: number) => void log.push(`progress${d}/${t}`),
    },
  };
}

describe('runScan', () => {
  it('shows, settles, captures and reports for every frame, in order', async () => {
    const r = recorder();
    expect(await runScan(2, r.deps, { cancelled: false })).toBe('done');
    expect(r.log).toEqual(['show0', 'settle', 'capture0', 'progress1/2', 'show1', 'settle', 'capture1', 'progress2/2']);
  });
  it('stops when cancelled between frames', async () => {
    const r = recorder();
    const signal = { cancelled: false };
    r.deps.capture = async (i: number) => {
      r.log.push(`capture${i}`);
      if (i === 0) signal.cancelled = true;
    };
    expect(await runScan(5, r.deps, signal)).toBe('cancelled');
    expect(r.log.filter((l) => l.startsWith('show'))).toEqual(['show0']);
  });
  it('stops after settling if cancelled during the wait', async () => {
    const r = recorder();
    const signal = { cancelled: false };
    r.deps.settle = async () => {
      signal.cancelled = true;
    };
    expect(await runScan(3, r.deps, signal)).toBe('cancelled');
    expect(r.log).toEqual(['show0']);
  });
  it('passes a capture failure on to the caller', async () => {
    const r = recorder();
    r.deps.capture = async () => {
      throw new Error('phone gone');
    };
    await expect(runScan(3, r.deps, { cancelled: false })).rejects.toThrow('phone gone');
  });
  it('does nothing for an empty scan', async () => {
    const r = recorder();
    expect(await runScan(0, r.deps, { cancelled: false })).toBe('done');
    expect(r.log).toEqual([]);
  });
});
```

`src/calibrate/luma.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { accumulateLuma, finishLuma } from './luma';

describe('luma', () => {
  it('turns RGBA into grey with the usual weights', () => {
    const acc = new Uint16Array(3);
    accumulateLuma(Uint8ClampedArray.from([255, 255, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255]), acc);
    const out = finishLuma(acc, 1);
    expect(out[0]).toBe(255);
    expect(out[1]).toBe(76); // red: (77 * 255) >> 8
    expect(out[2]).toBe(0);
  });
  it('averages several frames', () => {
    const acc = new Uint16Array(1);
    accumulateLuma(Uint8ClampedArray.from([100, 100, 100, 255]), acc);
    accumulateLuma(Uint8ClampedArray.from([200, 200, 200, 255]), acc);
    accumulateLuma(Uint8ClampedArray.from([150, 150, 150, 255]), acc);
    expect(finishLuma(acc, 3)[0]).toBe(150);
  });
});
```
(The grey formula is `(77 * r + 150 * g + 29 * b) >> 8`: white gives 255 and pure red gives `19635 >> 8 = 76`.)

`src/calibrate/steady.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { MOTION_LIMITS, isMoving, magnitude } from './steady';

describe('steadiness', () => {
  it('computes a vector length and treats missing values as zero', () => {
    expect(magnitude(3, 4, 0)).toBe(5);
    expect(magnitude(null, undefined, 2)).toBe(2);
    expect(magnitude(NaN, 0, 0)).toBe(0);
  });
  it('is steady below both limits and moving above either', () => {
    expect(isMoving({ rotation: 0, accel: 0 })).toBe(false);
    expect(isMoving({ rotation: MOTION_LIMITS.rotation, accel: MOTION_LIMITS.accel })).toBe(false);
    expect(isMoving({ rotation: MOTION_LIMITS.rotation + 1, accel: 0 })).toBe(true);
    expect(isMoving({ rotation: 0, accel: MOTION_LIMITS.accel + 0.1 })).toBe(true);
  });
});
```

`src/calibrate/link.test.ts`:
```ts
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
```

`src/calibrate/qr.test.ts`:
```ts
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
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run src/calibrate/scan-driver.test.ts src/calibrate/luma.test.ts src/calibrate/steady.test.ts src/calibrate/link.test.ts src/calibrate/qr.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement**

`src/calibrate/scan-driver.ts`:
```ts
export interface ScanDeps {
  /** Paint scan frame `i` on the projector. */
  showFrame(i: number): void | Promise<void>;
  /** Wait for the camera to see the change. */
  settle(): Promise<void>;
  /** Ask the phone to capture frame `i`; resolves when it says done, rejects on timeout or error. */
  capture(i: number): Promise<void>;
  onProgress?(done: number, total: number): void;
}

/** Walk the scan frames: show, settle, capture, report. Stops early when `signal.cancelled` turns true. */
export async function runScan(total: number, deps: ScanDeps, signal: { cancelled: boolean }): Promise<'done' | 'cancelled'> {
  for (let i = 0; i < total; i++) {
    if (signal.cancelled) return 'cancelled';
    await deps.showFrame(i);
    await deps.settle();
    if (signal.cancelled) return 'cancelled';
    await deps.capture(i);
    deps.onProgress?.(i + 1, total);
  }
  return 'done';
}
```

`src/calibrate/luma.ts`:
```ts
/** Add one RGBA camera frame's grey levels into `acc` (one entry per pixel). */
export function accumulateLuma(rgba: Uint8ClampedArray, acc: Uint16Array): void {
  for (let p = 0; p < acc.length; p++) {
    const i = p * 4;
    acc[p] += (77 * rgba[i] + 150 * rgba[i + 1] + 29 * rgba[i + 2]) >> 8;
  }
}

/** The average grey frame of `count` accumulated frames. */
export function finishLuma(acc: Uint16Array, count: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(acc.length);
  for (let p = 0; p < acc.length; p++) out[p] = Math.round(acc[p] / count);
  return out;
}
```

`src/calibrate/steady.ts`:
```ts
/** Above these the phone counts as moving: rotation in degrees per second, acceleration in m/s^2 (gravity removed). */
export const MOTION_LIMITS = { rotation: 20, accel: 1.2 };

export interface MotionSample {
  rotation: number;
  accel: number;
}

/** Length of a 3-vector; missing or non-finite parts count as zero. */
export function magnitude(a: number | null | undefined, b: number | null | undefined, c: number | null | undefined): number {
  const f = (v: number | null | undefined) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return Math.sqrt(f(a) ** 2 + f(b) ** 2 + f(c) ** 2);
}

export function isMoving(s: MotionSample, limits = MOTION_LIMITS): boolean {
  return s.rotation > limits.rotation || s.accel > limits.accel;
}
```

`src/calibrate/link.ts`:
```ts
/** A random 128-bit session token as 32 lowercase hex characters. */
export function newSessionId(fill: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const bytes = fill(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The address the phone opens (the QR code holds this). */
export function buildCameraLink(host: string, port: string, protocol: string, session: string): string {
  const scheme = protocol.replace(/:$/, '');
  return `${scheme}://${host}${port ? `:${port}` : ''}/camera.html?s=${session}`;
}
```

`src/calibrate/qr.ts`:
```ts
import qrcode from 'qrcode-generator';

/** A QR code as one SVG path in module units: draw it in a viewBox of `size` x `size`. */
export function qrPath(text: string): { size: number; d: string } {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const size = qr.getModuleCount();
  let d = '';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) if (qr.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
  }
  return { size, d };
}
```

`src/calibrate/relay-client.ts` (DOM; no unit test — read in review and exercised on the phone):
```ts
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
```

- [ ] **Step 5: Run to verify, then commit**

Run: `npx vitest run src/calibrate && npx tsc --noEmit && npm test && npm run build`
Expected: PASS.
```bash
git add package.json package-lock.json src/calibrate src/types
git commit -m "feat(calibrate): scan driver, luma, steadiness, link, QR path and relay client

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
(`git add src/types` only if you created it; the command must not fail if it does not exist: add paths individually.)

---

### Task 6: The phone camera page

**Files:**
- Create: `camera.html`, `src/calibrate/camera-main.tsx`, `src/calibrate/CameraApp.tsx`
- Modify: `vite.config.ts` (add the `camera` entry)

**Interfaces:**
- Consumes: `decodeScan` (T2), `frameCount`, `CAPTURE_FRAMES` (T1), `encodeCalibMsg`/`parseCalibMsg`/`CalibMsg` (T4), `createRelayClient` (T5), `accumulateLuma`/`finishLuma` (T5), `MOTION_LIMITS`/`isMoving`/`magnitude` (T5), `useWakeLock` from `../ui/wakeLock`.
- Produces: the page `/camera.html?s=<session>`.

No unit tests (DOM, camera). Verification is tsc + build, then reading against the checklist in Step 4.

- [ ] **Step 1: The entry files**

`camera.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>HyperMapping Camera</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/calibrate/camera-main.tsx"></script>
  </body>
</html>
```

`src/calibrate/camera-main.tsx`:
```tsx
import { createRoot } from 'react-dom/client';
import '../index.css';
import { CameraApp } from './CameraApp';

createRoot(document.getElementById('root')!).render(<CameraApp />);
```

In `vite.config.ts` add to `rollupOptions.input`: `camera: fileURLToPath(new URL('./camera.html', import.meta.url)),`

- [ ] **Step 2: The page**

`src/calibrate/CameraApp.tsx`:
```tsx
import { useEffect, useMemo, useRef, useState } from 'react';
import { useWakeLock } from '../ui/wakeLock';
import { decodeScan } from './decode';
import { accumulateLuma, finishLuma } from './luma';
import { CAPTURE_FRAMES, frameCount } from './patterns';
import { encodeCalibMsg, parseCalibMsg, type CalibMsg } from './protocol';
import { createRelayClient, type RelayClient } from './relay-client';
import { MOTION_LIMITS, isMoving, magnitude } from './steady';

const ANALYSIS_WIDTH = 640;
const FRAME_GAP_MS = 40;
/** Under this share of lit pixels the scan is treated as "the projector is not on the box". */
const MIN_LIT_SHARE = 0.05;

type Stage = 'start' | 'live' | 'scanning' | 'done' | 'error';

interface Scan {
  gw: number;
  gh: number;
  total: number;
  frames: Uint8ClampedArray[];
  preview: string;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The phone side: shows the camera, answers the laptop's scan, decodes it and sends the map back. */
export function CameraApp() {
  const session = useMemo(() => {
    const s = new URLSearchParams(location.search).get('s') ?? '';
    return /^[0-9a-f]{32}$/.test(s) ? s : null;
  }, []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const relayRef = useRef<RelayClient | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dimsRef = useRef({ w: 0, h: 0 });
  const scanRef = useRef<Scan | null>(null);
  const movedRef = useRef(false);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const [stage, setStage] = useState<Stage>(session ? 'start' : 'error');
  const [status, setStatus] = useState(session ? 'Tap Start, then point the phone at the box.' : 'This link is not valid: scan the QR code again.');
  const [progress, setProgress] = useState('');
  useWakeLock(stage === 'live' || stage === 'scanning');

  const send = (msg: CalibMsg) => void relayRef.current?.send(encodeCalibMsg(msg));

  const fail = (reason: 'moved' | 'camera' | 'timeout' | 'dark' | 'other', detail?: string, text?: string) => {
    scanRef.current = null;
    send(detail === undefined ? { type: 'error', reason } : { type: 'error', reason, detail });
    setStage('live');
    setStatus(text ?? 'The scan stopped. Press Start scan on the laptop to try again.');
  };

  /** Average CAPTURE_FRAMES camera frames into one grey frame. */
  const grabGray = async (): Promise<Uint8ClampedArray> => {
    const { w, h } = dimsRef.current;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const acc = new Uint16Array(w * h);
    for (let i = 0; i < CAPTURE_FRAMES; i++) {
      ctx.drawImage(videoRef.current!, 0, 0, w, h);
      accumulateLuma(ctx.getImageData(0, 0, w, h).data, acc);
      if (i < CAPTURE_FRAMES - 1) await wait(FRAME_GAP_MS);
    }
    return finishLuma(acc, CAPTURE_FRAMES);
  };

  const capture = async (frame: number) => {
    const scan = scanRef.current;
    if (!scan) return;
    if (frame !== scan.frames.length) return fail('other', 'frame out of order');
    if (movedRef.current) return fail('moved', undefined, 'The phone moved during the scan. Hold it still and try again.');
    const gray = await grabGray();
    if (frame === 0) scan.preview = canvasRef.current!.toDataURL('image/jpeg', 0.7);
    scan.frames.push(gray);
    if (movedRef.current) return fail('moved', undefined, 'The phone moved during the scan. Hold it still and try again.');
    setProgress(`${scan.frames.length} / ${scan.total}`);
    send({ type: 'frame-done', frame });
    if (scan.frames.length === scan.total) await finish(scan);
  };

  const finish = async (scan: Scan) => {
    setStatus('Working out the picture…');
    await wait(30); // let the status paint before the heavy loop
    const { w, h } = dimsRef.current;
    try {
      const map = decodeScan(scan.frames, w, h, scan.gw, scan.gh);
      let lit = 0;
      for (let p = 0; p < map.mask.length; p++) lit += map.mask[p];
      if (lit / map.mask.length < MIN_LIT_SHARE) {
        return fail('dark', undefined, 'The projector picture was not seen. Aim at the box and dim the room.');
      }
      scanRef.current = null;
      send({ type: 'scan-result', map, preview: scan.preview });
      setStage('done');
      setStatus('Done. Tap the box corners on the laptop.');
    } catch (e) {
      fail('other', e instanceof Error ? e.message.slice(0, 150) : 'decode failed');
    }
  };

  const onMessage = (text: string) => {
    const msg = parseCalibMsg(text);
    if (!msg) return;
    if (msg.type === 'scan-start') {
      const total = frameCount(msg.gw, msg.gh);
      movedRef.current = false;
      scanRef.current = { gw: msg.gw, gh: msg.gh, total, frames: [], preview: '' };
      queueRef.current = Promise.resolve();
      setStage('scanning');
      setStatus('Scanning: hold the phone still.');
      setProgress(`0 / ${total}`);
    } else if (msg.type === 'show') {
      queueRef.current = queueRef.current.then(() => capture(msg.frame)).catch(() => fail('other', 'capture failed'));
    } else if (msg.type === 'scan-cancel') {
      scanRef.current = null;
      setStage('live');
      setStatus('Scan cancelled.');
    }
  };

  const start = async () => {
    if (!session) return;
    try {
      // iOS asks for motion access from a tap.
      const DME = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
      if (typeof DME.requestPermission === 'function') await DME.requestPermission().catch(() => {});
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      const track = stream.getVideoTracks()[0];
      // Best effort: stop the camera re-adjusting its exposure while the projector flashes.
      await track.applyConstraints({ advanced: [{ exposureMode: 'manual' } as MediaTrackConstraintSet] }).catch(() => {});
      const w = Math.min(ANALYSIS_WIDTH, video.videoWidth);
      const h = Math.round((w * video.videoHeight) / video.videoWidth);
      dimsRef.current = { w, h };
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvasRef.current = canvas;
      const relay = createRelayClient(session, 'phone');
      relayRef.current = relay;
      relay.onMessage(onMessage);
      send({ type: 'hello', width: w, height: h });
      send({ type: 'ready' });
      setStage('live');
      setStatus('Connected. Point the phone at the box, then press Start scan on the laptop.');
    } catch (e) {
      setStage('error');
      setStatus(e instanceof Error ? `Could not start the camera: ${e.message}` : 'Could not start the camera.');
    }
  };

  useEffect(() => {
    const onMotion = (ev: DeviceMotionEvent) => {
      if (!scanRef.current) return;
      const r = ev.rotationRate;
      const a = ev.acceleration;
      if (isMoving({ rotation: magnitude(r?.alpha, r?.beta, r?.gamma), accel: magnitude(a?.x, a?.y, a?.z) }, MOTION_LIMITS)) {
        movedRef.current = true;
      }
    };
    window.addEventListener('devicemotion', onMotion);
    return () => {
      window.removeEventListener('devicemotion', onMotion);
      relayRef.current?.close();
      const stream = videoRef.current?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  return (
    <div className="fixed inset-0 select-none bg-black text-white">
      <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-contain" />
      <div className="absolute inset-x-0 bottom-0 space-y-2 bg-black/70 p-4 text-base">
        <p>{status}</p>
        {stage === 'scanning' && <p className="text-zinc-300">{progress}</p>}
        {stage === 'start' && (
          <button className="rounded-lg bg-cyan-500 px-5 py-3 font-medium text-black" onClick={() => void start()}>
            Start camera
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all pass, and `dist/camera.html` exists. The build must list the `camera` entry.

- [ ] **Step 4: Read-through checklist (include in the report)**

Confirm against the code: (a) a message arriving out of order, a capture error, motion and a dark scan each call `fail(...)`, which clears `scanRef`, posts an `error` and returns the page to `live`; (b) captures are serialised through `queueRef` so two `show` messages cannot overlap; (c) nothing is sent to the laptop except through `encodeCalibMsg`; (d) on unmount the relay is closed and the camera tracks are stopped; (e) the scan only starts after the user tapped Start (camera and iOS motion permission need a gesture); (f) no call can throw out of `onMessage` unhandled.

- [ ] **Step 5: Commit**

```bash
git add camera.html src/calibrate/camera-main.tsx src/calibrate/CameraApp.tsx vite.config.ts
git commit -m "feat(calibrate): the phone camera page

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The Output window shows scan frames and reports its size

**Files:**
- Modify: `src/output/protocol.ts`, `src/output/protocol.test.ts`, `src/ui/Output.tsx`
- Create: `src/ui/useScanDisplay.ts`

**Interfaces:**
- Consumes: `FrameSpec`, `parseFrameSpec`, `drawScanFrame` (T1).
- Produces: `Msg` gains `{ type: 'scan-frame'; spec: FrameSpec | null; gw: number; gh: number; pw: number; ph: number }`, `{ type: 'probe' }`, `{ type: 'output-size'; w: number; h: number; fullscreen: boolean }`.

- [ ] **Step 1: Write the failing tests**

Add inside the existing `describe('parseMsg', ...)` in `src/output/protocol.test.ts`:
```ts
  it('accepts a probe and an output-size report', () => {
    expect(parseMsg({ type: 'probe' })).toEqual({ type: 'probe' });
    expect(parseMsg({ type: 'output-size', w: 1920, h: 1080, fullscreen: true })).toEqual({
      type: 'output-size',
      w: 1920,
      h: 1080,
      fullscreen: true,
    });
  });
  it('rejects a bad output-size', () => {
    for (const bad of [
      { type: 'output-size', w: 0, h: 10, fullscreen: true },
      { type: 'output-size', w: 10, h: 1.5, fullscreen: true },
      { type: 'output-size', w: 10, h: 10 },
      { type: 'output-size', w: 100000, h: 10, fullscreen: false },
    ]) {
      expect(parseMsg(bad), JSON.stringify(bad)).toBeNull();
    }
  });
  it('accepts a scan frame, or null to go back to normal', () => {
    const base = { type: 'scan-frame', gw: 16, gh: 8, pw: 64, ph: 32 };
    expect(parseMsg({ ...base, spec: { kind: 'white' } })).toEqual({ ...base, spec: { kind: 'white' } });
    expect(parseMsg({ ...base, spec: null })).toEqual({ ...base, spec: null });
  });
  it('rejects a malformed scan frame', () => {
    const base = { type: 'scan-frame', gw: 16, gh: 8, pw: 64, ph: 32 };
    for (const bad of [
      { ...base, spec: { kind: 'nope' } },
      { ...base, spec: undefined },
      { ...base, spec: { kind: 'white' }, gw: 0 },
      { ...base, spec: { kind: 'white' }, pw: 1e9 },
      { ...base, spec: { kind: 'white' }, gh: 'x' },
    ]) {
      expect(parseMsg(bad), JSON.stringify(bad)).toBeNull();
    }
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/output`
Expected: FAIL (new types return `null`).

- [ ] **Step 3: Implement the messages**

In `src/output/protocol.ts` add the import `import { parseFrameSpec, type FrameSpec } from '../calibrate/patterns';`, add these variants to `Msg`:
```ts
  | { type: 'probe' } // editor -> output: "tell me your size"
  | { type: 'output-size'; w: number; h: number; fullscreen: boolean } // output -> editor
  | { type: 'scan-frame'; spec: FrameSpec | null; gw: number; gh: number; pw: number; ph: number } // editor -> output: calibration frame, or null to go back
```
and these cases in `parseMsg` (before `default`):
```ts
    case 'probe':
      return { type: 'probe' };
    case 'output-size':
      return isDim(d.w) && isDim(d.h) && typeof d.fullscreen === 'boolean'
        ? { type: 'output-size', w: d.w, h: d.h, fullscreen: d.fullscreen }
        : null;
    case 'scan-frame': {
      if (!isDim(d.gw) || !isDim(d.gh) || !isDim(d.pw) || !isDim(d.ph)) return null;
      if (d.spec === null) return { type: 'scan-frame', spec: null, gw: d.gw, gh: d.gh, pw: d.pw, ph: d.ph };
      const spec = parseFrameSpec(d.spec);
      return spec ? { type: 'scan-frame', spec, gw: d.gw, gh: d.gh, pw: d.pw, ph: d.ph } : null;
    }
```
with this helper above `parseMsg`: `const isDim = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 16384;`

- [ ] **Step 4: The Output window overlay**

`src/ui/useScanDisplay.ts`:
```ts
import { useEffect, useRef } from 'react';
import { drawScanFrame } from '../calibrate/patterns';
import { CHANNEL, parseMsg } from '../output/protocol';

/**
 * The projector side of calibration: tells the Editor how big this window is, and paints scan frames
 * on an overlay canvas (which covers the picture while a frame is up; null hides it again).
 */
export function useScanDisplay() {
  const overlayRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const ch = new BroadcastChannel(CHANNEL);
    const report = () =>
      ch.postMessage({ type: 'output-size', w: window.innerWidth, h: window.innerHeight, fullscreen: document.fullscreenElement !== null });
    const hide = () => {
      if (overlayRef.current) overlayRef.current.style.display = 'none';
    };
    ch.onmessage = (ev) => {
      const msg = parseMsg(ev.data);
      if (!msg) return;
      if (msg.type === 'probe') report();
      else if (msg.type === 'scan-frame') {
        const canvas = overlayRef.current;
        if (!canvas) return;
        if (msg.spec === null) return hide();
        canvas.width = msg.pw;
        canvas.height = msg.ph;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        drawScanFrame(ctx, msg.spec, msg.pw, msg.ph, msg.gw, msg.gh);
        canvas.style.display = 'block';
      }
    };
    report();
    window.addEventListener('resize', report);
    document.addEventListener('fullscreenchange', report);
    return () => {
      window.removeEventListener('resize', report);
      document.removeEventListener('fullscreenchange', report);
      hide();
      ch.close();
    };
  }, []);

  return overlayRef;
}
```

In `src/ui/Output.tsx` add `import { useScanDisplay } from './useScanDisplay';`, call `const scanRef = useScanDisplay();` after `useOutputFeed`, and add inside the container, after the `<canvas ...>`:
```tsx
      <canvas ref={scanRef} className="absolute inset-0 h-full w-full" style={{ display: 'none' }} />
```

- [ ] **Step 5: Verify and commit**

Run: `npx vitest run src/output && npx tsc --noEmit && npm test && npm run build`
Expected: PASS. Report that `useScanDisplay` has no unit test (DOM). Read-through: the overlay is hidden on unmount; a `scan-frame` with `spec: null` hides it; messages the hook does not own are ignored; the existing `useOutputFeed` (which uses the same channel name) simply ignores the new message types.
```bash
git add src/output src/ui/useScanDisplay.ts src/ui/Output.tsx
git commit -m "feat(ui): Output window paints scan frames and reports its size

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 8: The Calibrate panel in the Editor

**Files:**
- Create: `src/ui/QrCode.tsx`, `src/ui/CalibratePanel.tsx`
- Modify: `src/ui/Editor.tsx`, `README.md`

**Interfaces:**
- Consumes: everything above. `CalibratePanel` props: `{ surfaces: Surface[]; onApply: (list: Surface[]) => void; onClose: () => void }`.
- Produces: the **Calibrate** toolbar button and the panel.

UI wiring has no unit tests (DOM). Verification is tsc, the full test run and the build, then the read-through checklist; Lyndz does the real test.

- [ ] **Step 1: The QR component**

`src/ui/QrCode.tsx`:
```tsx
import { useMemo } from 'react';
import { qrPath } from '../calibrate/qr';

/** A QR code drawn as one SVG path (no images, nothing fetched). */
export function QrCode({ text, className }: { text: string; className?: string }) {
  const { size, d } = useMemo(() => qrPath(text), [text]);
  return (
    <svg viewBox={`-2 -2 ${size + 4} ${size + 4}`} className={className} shapeRendering="crispEdges" role="img" aria-label="QR code for the camera link">
      <rect x={-2} y={-2} width={size + 4} height={size + 4} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
```

- [ ] **Step 2: The panel**

`src/ui/CalibratePanel.tsx`:
```tsx
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { applyCalibration, tapToCamera, tapsToCorners } from '../calibrate/corners';
import type { ScanMap } from '../calibrate/decode';
import { buildCameraLink, newSessionId } from '../calibrate/link';
import { SETTLE_MS, STEP_PX, frameCount, frameSpec } from '../calibrate/patterns';
import { encodeCalibMsg, parseCalibMsg, type CalibMsg } from '../calibrate/protocol';
import { createRelayClient, type RelayClient } from '../calibrate/relay-client';
import { runScan } from '../calibrate/scan-driver';
import { CHANNEL, parseMsg } from '../output/protocol';
import type { Surface } from '../surfaces/types';
import type { Corners, Vec2 } from '../warp/types';
import { QrCode } from './QrCode';

interface Props {
  surfaces: Surface[];
  onApply: (list: Surface[]) => void;
  onClose: () => void;
}

type Stage = 'connect' | 'scanning' | 'decoding' | 'tap';
const FRAME_DONE_TIMEOUT_MS = 8000;
const CORNER_NAMES = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
const btn = 'rounded-lg px-4 py-3 font-medium';

/** Pair a phone, run the scan, tap the corners, and apply the result. A modal panel over the Editor. */
export function CalibratePanel({ surfaces, onApply, onClose }: Props) {
  const session = useMemo(() => newSessionId(), []);
  const [addresses, setAddresses] = useState<string[] | null>(null);
  const [phone, setPhone] = useState<{ width: number; height: number } | null>(null);
  const [output, setOutput] = useState<{ w: number; h: number; fullscreen: boolean } | null>(null);
  const [stage, setStage] = useState<Stage>('connect');
  const [progress, setProgress] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<{ map: ScanMap; preview: string } | null>(null);
  const [faceIndex, setFaceIndex] = useState(0);
  const [taps, setTaps] = useState<Vec2[]>([]);
  const [solved, setSolved] = useState<Record<string, Corners>>({});

  const relayRef = useRef<RelayClient | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const signalRef = useRef({ cancelled: false });
  const frameWaitRef = useRef<{ frame: number; resolve: () => void; reject: (e: Error) => void } | null>(null);
  const projectorRef = useRef<{ w: number; h: number } | null>(null);

  const sendPhone = (msg: CalibMsg) => void relayRef.current?.send(encodeCalibMsg(msg));
  const showNormal = () =>
    channelRef.current?.postMessage({ type: 'scan-frame', spec: null, gw: 1, gh: 1, pw: 1, ph: 1 });

  useEffect(() => {
    const relay = createRelayClient(session, 'laptop');
    relayRef.current = relay;
    const ch = new BroadcastChannel(CHANNEL);
    channelRef.current = ch;
    const signal = signalRef.current;

    relay.onMessage((text) => {
      const msg = parseCalibMsg(text);
      if (!msg) return;
      if (msg.type === 'hello') setPhone({ width: msg.width, height: msg.height });
      else if (msg.type === 'frame-done') {
        const w = frameWaitRef.current;
        if (w && w.frame === msg.frame) {
          frameWaitRef.current = null;
          w.resolve();
        }
      } else if (msg.type === 'error') {
        signal.cancelled = true;
        frameWaitRef.current?.reject(new Error('phone reported a problem'));
        frameWaitRef.current = null;
        showNormal();
        setStage('connect');
        setMessage(
          msg.reason === 'moved'
            ? 'The phone moved during the scan. Hold it still and try again.'
            : msg.reason === 'dark'
              ? 'The phone did not see the projector picture. Aim at the box and dim the room.'
              : `The phone stopped the scan (${msg.reason}). Try again.`,
        );
      } else if (msg.type === 'scan-result') {
        setResult({ map: msg.map, preview: msg.preview });
        setFaceIndex(0);
        setTaps([]);
        setSolved({});
        setMessage(null);
        setStage('tap');
      }
    });

    ch.onmessage = (ev) => {
      const msg = parseMsg(ev.data);
      if (msg?.type === 'output-size') setOutput({ w: msg.w, h: msg.h, fullscreen: msg.fullscreen });
    };
    ch.postMessage({ type: 'probe' });

    fetch('/calib/info', { cache: 'no-store' })
      .then((r) => r.json() as Promise<{ addresses?: string[] }>)
      .then((d) => setAddresses(Array.isArray(d.addresses) ? d.addresses.filter((a) => typeof a === 'string') : []))
      .catch(() => setAddresses([]));

    return () => {
      signal.cancelled = true;
      frameWaitRef.current?.reject(new Error('closed'));
      frameWaitRef.current = null;
      ch.postMessage({ type: 'scan-frame', spec: null, gw: 1, gh: 1, pw: 1, ph: 1 });
      ch.close();
      relay.close();
    };
  }, [session]);

  const cameraLink = useMemo(() => {
    if (addresses === null) return null;
    const isLan = !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    const host = isLan ? location.hostname : addresses[0];
    return host ? buildCameraLink(host, location.port, location.protocol, session) : null;
  }, [addresses, session]);

  const startScan = async () => {
    if (!output || !phone) return;
    const pw = output.w;
    const ph = output.h;
    projectorRef.current = { w: pw, h: ph };
    const gw = Math.ceil(pw / STEP_PX);
    const gh = Math.ceil(ph / STEP_PX);
    const total = frameCount(gw, gh);
    const signal = signalRef.current;
    signal.cancelled = false;
    setMessage(null);
    setStage('scanning');
    setProgress(`0 / ${total}`);
    sendPhone({ type: 'scan-start', gw, gh });
    try {
      const outcome = await runScan(
        total,
        {
          showFrame: (i) => channelRef.current?.postMessage({ type: 'scan-frame', spec: frameSpec(i, gw, gh), gw, gh, pw, ph }),
          settle: () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS)),
          capture: (i) =>
            new Promise<void>((resolve, reject) => {
              const timer = setTimeout(() => {
                frameWaitRef.current = null;
                reject(new Error('the phone stopped answering'));
              }, FRAME_DONE_TIMEOUT_MS);
              frameWaitRef.current = {
                frame: i,
                resolve: () => {
                  clearTimeout(timer);
                  resolve();
                },
                reject: (e) => {
                  clearTimeout(timer);
                  reject(e);
                },
              };
              sendPhone({ type: 'show', frame: i, of: total });
            }),
          onProgress: (d, t) => setProgress(`${d} / ${t}`),
        },
        signal,
      );
      showNormal();
      if (outcome === 'done') {
        setStage('decoding');
        setMessage('Working out the picture…');
      }
    } catch (e) {
      showNormal();
      sendPhone({ type: 'scan-cancel' });
      if (!signal.cancelled) {
        setStage('connect');
        setMessage(e instanceof Error ? `Scan stopped: ${e.message}.` : 'Scan stopped.');
      }
    }
  };

  const cancelScan = () => {
    signalRef.current.cancelled = true;
    frameWaitRef.current?.reject(new Error('cancelled'));
    frameWaitRef.current = null;
    sendPhone({ type: 'scan-cancel' });
    showNormal();
    setStage('connect');
  };

  const onPictureTap = (e: PointerEvent<HTMLDivElement>) => {
    if (!result || !projectorRef.current || faceIndex >= surfaces.length) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const tap = tapToCamera(e.clientX, e.clientY, rect, result.map.width, result.map.height);
    if (!tap) return;
    const next = [...taps, tap];
    if (next.length < 4) {
      setTaps(next);
      setMessage(null);
      return;
    }
    const r = tapsToCorners(result.map, next as [Vec2, Vec2, Vec2, Vec2], projectorRef.current);
    if (r.ok) {
      setSolved((s) => ({ ...s, [surfaces[faceIndex].id]: r.corners }));
      setTaps([]);
      setFaceIndex(faceIndex + 1);
      setMessage(null);
    } else {
      setTaps([]);
      setMessage(
        r.reason === 'unlit'
          ? `The ${r.failed.map((i) => CORNER_NAMES[i]).join(' and ')} tap was not on a lit part of the box. Tap that face again.`
          : 'Those corners do not make a proper shape. Tap them again in order: top-left, top-right, bottom-right, bottom-left.',
      );
    }
  };

  const skipFace = () => {
    setTaps([]);
    setFaceIndex(faceIndex + 1);
    setMessage(null);
  };

  const apply = () => {
    onApply(applyCalibration(surfaces, solved));
    onClose();
  };

  const solvedCount = Object.keys(solved).length;
  const face = surfaces[faceIndex];

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-black/80 p-4">
      <div className="w-full max-w-3xl space-y-4 rounded-xl bg-zinc-900 p-4 text-sm select-text">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Camera calibration</h2>
          <button className={`${btn} bg-zinc-700`} onClick={onClose}>
            {stage === 'tap' && solvedCount > 0 ? 'Cancel' : 'Close'}
          </button>
        </div>

        {message && <p className="rounded-lg bg-amber-900/60 p-3 text-amber-200">{message}</p>}

        {(stage === 'connect' || stage === 'scanning' || stage === 'decoding') && (
          <div className="space-y-3">
            <ol className="list-decimal space-y-1 pl-5 text-zinc-300">
              <li>Scan this code with the phone and allow the camera. Point the phone at the box and hold it still.</li>
              <li>Press <b>Open output window</b> in the toolbar, drag it to the projector and click it once for fullscreen.</li>
              <li>Press <b>Start scan</b>. The projector flashes for about 15 seconds.</li>
            </ol>
            <div className="flex flex-wrap items-center gap-4">
              {cameraLink ? (
                <div className="space-y-1">
                  <QrCode text={cameraLink} className="h-44 w-44 rounded bg-white" />
                  <p className="max-w-xs break-all text-xs text-zinc-400">{cameraLink}</p>
                </div>
              ) : (
                <p className="max-w-xs text-amber-300">
                  {addresses === null
                    ? 'Looking for this computer’s network address…'
                    : 'Could not find a network address. Open the app from the phone’s address instead of localhost, or check Wi-Fi.'}
                </p>
              )}
              <ul className="space-y-1">
                <li>Phone: {phone ? `connected (${phone.width}×${phone.height})` : 'waiting…'}</li>
                <li>
                  Output window:{' '}
                  {output ? `${output.w}×${output.h}${output.fullscreen ? ' (fullscreen)' : ' (NOT fullscreen)'}` : 'not open'}
                </li>
              </ul>
            </div>
            {output && !output.fullscreen && (
              <p className="text-amber-300">
                The Output window is not fullscreen, so the pins would fit this window, not the projector. Click the Output window once to make it
                fullscreen on the projector.
              </p>
            )}
            <div className="flex items-center gap-3">
              <button
                className={`${btn} ${phone && output && stage === 'connect' ? 'bg-cyan-500 text-black' : 'bg-zinc-700 text-zinc-400'}`}
                disabled={!phone || !output || stage !== 'connect'}
                onClick={() => void startScan()}
              >
                Start scan
              </button>
              {stage === 'scanning' && (
                <>
                  <span>Scanning… {progress}</span>
                  <button className={`${btn} bg-zinc-700`} onClick={cancelScan}>
                    Stop
                  </button>
                </>
              )}
              {stage === 'decoding' && <span>Waiting for the phone to finish…</span>}
            </div>
          </div>
        )}

        {stage === 'tap' && result && (
          <div className="space-y-3">
            {face ? (
              <p>
                Face {faceIndex + 1} of {surfaces.length}: tap its corners on the picture in this order: top-left, top-right, bottom-right,
                bottom-left. Next: <b>{CORNER_NAMES[taps.length]}</b>.
              </p>
            ) : (
              <p>All faces done. Press Apply to use the new pins, or Cancel.</p>
            )}
            <div className="relative touch-none select-none" onPointerDown={onPictureTap}>
              <img src={result.preview} alt="What the phone saw" className="w-full" draggable={false} />
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox={`0 0 ${result.map.width} ${result.map.height}`}
                preserveAspectRatio="none"
              >
                {taps.length > 1 && <polyline points={taps.map((t) => t.join(',')).join(' ')} fill="none" stroke="#22d3ee" strokeWidth={2} />}
                {taps.map((t, i) => (
                  <circle key={i} cx={t[0]} cy={t[1]} r={5} fill="#22d3ee" />
                ))}
              </svg>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={`${btn} bg-zinc-700`} disabled={taps.length === 0} onClick={() => setTaps(taps.slice(0, -1))}>
                Undo tap
              </button>
              <button className={`${btn} bg-zinc-700`} disabled={!face} onClick={skipFace}>
                Skip this face
              </button>
              <button
                className={`${btn} ${solvedCount > 0 ? 'bg-cyan-500 text-black' : 'bg-zinc-700 text-zinc-400'}`}
                disabled={solvedCount === 0}
                onClick={apply}
              >
                Apply ({solvedCount} {solvedCount === 1 ? 'face' : 'faces'})
              </button>
            </div>
            <p className="text-xs text-zinc-400">Apply replaces the corners of the faces you tapped. Save a setup first if you want to keep the old pins.</p>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire it into the Editor**

In `src/ui/Editor.tsx`: add `import { CalibratePanel } from './CalibratePanel';`; add state `const [calibrateOpen, setCalibrateOpen] = useState(false);` next to `setupsOpen`; add a toolbar button right after the **Setups** button:
```tsx
          <button className="rounded-lg bg-zinc-700 px-4 py-3" onClick={() => setCalibrateOpen(true)}>
            Calibrate
          </button>
```
and render, after the Setups panel block:
```tsx
      {mode === 'edit' && calibrateOpen && (
        <CalibratePanel
          surfaces={surfacesRef.current}
          onApply={(list) => adoptLayoutRef.current(list)}
          onClose={() => setCalibrateOpen(false)}
        />
      )}
```

- [ ] **Step 4: README**

Add a section after "Virtual projector (simulator)":
```markdown
## Camera calibration

Let a phone camera find the pins for you.

1. Press **Calibrate**, scan the QR code with the phone (accept the certificate warning, allow the camera) and point it at the box. Hold it still.
2. Open the **Output window**, drag it to the projector and click it once for fullscreen.
3. Press **Start scan**. The projector flashes stripes for about 15 seconds; the phone watches.
4. The phone's picture appears. For each face tap its four corners: top-left, top-right, bottom-right, bottom-left. **Apply** replaces those faces' pins (save a setup first if you want to keep the old ones); then nudge as usual.

- The phone and the computer must be on the same Wi-Fi. The link goes through the app's own server, so use the one-click launcher (or `npm run dev` / `npm run preview`), not a static host.
- The pins are only right when the Output window fills the projector image (see the notes under Virtual projector).
- Dim the room, aim so the projected picture covers the faces, and keep the phone steady. A tap on an unlit part of a face is refused with a message.
```

- [ ] **Step 5: Verify and commit**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all pass (no new unit tests in this task; say so).

Read-through checklist for the report, each confirmed against the code: (a) the effect cleanup cancels the signal, rejects a pending frame wait, hides the Output overlay (`scan-frame` null), closes the channel and the relay; (b) `Apply` is the only place `onApply` is called, and Close/Cancel never calls it; (c) every `catch` path in `startScan` hides the overlay and tells the phone `scan-cancel`; (d) the Start scan button is disabled unless the phone and Output window are both present and the stage is `connect`; (e) each button has exactly ONE `bg-*` colour class per state; (f) `tapToCamera` uses the shown image's rectangle and the map's width/height; (g) nothing in the panel mutates `surfaces` (it passes the array to `applyCalibration` which copies).
```bash
git add src/ui/QrCode.tsx src/ui/CalibratePanel.tsx src/ui/Editor.tsx README.md
git commit -m "feat(ui): Calibrate panel with QR pairing, scan, tap-to-corners and Apply

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** scan frames (Task 1); decoding with mask and noise tolerance (Task 2); tap → projector point, corners, apply (Task 3); messages, relay mailbox, caps, plugin, LAN info (Task 4); scan driver, luma, steadiness, link, QR, relay client (Task 5); phone page with motion check, wake lock, preview, decode on phone (Task 6); Output window overlay and size reporting (Task 7); Editor panel, toolbar button, README (Task 8). Spec edge cases 1–10: 1–2 Task 1, 3–5 Task 2, 4/6/7/8 Task 3, 9 Task 4, 10 Task 4 (mailbox + relay-handler).

**Placeholder scan:** none; every step carries its code. Two items depend on the installed environment and say so: the `qrcode-generator` type declaration (Task 5 Step 1) and the `computeHomography` direction (Task 2 Step 4).

**Type consistency:** `ScanMap` (decode.ts) is used unchanged by corners, protocol and the panel; `FrameSpec`/`frameSpec`/`parseFrameSpec` match across patterns, the Output protocol and the panel; `CalibMsg` names (`show`, `scan-start`, `scan-cancel`, `hello`, `ready`, `frame-done`, `scan-result`, `error`) are spelled the same in protocol, CameraApp and CalibratePanel; Output-channel messages `scan-frame`, `probe`, `output-size` match between protocol, `useScanDisplay` and the panel; `TapResult` fields `ok`, `corners`, `failed`, `reason` match corners.ts and the panel.

**Known risks to watch at execution time:** `computeHomography` direction (Task 2); 1 px accuracy on real decoded scans (Task 3, report the measured error); the Vite plugin runs only when Vite loads the config, so it is exercised by the build and by Lyndz (Task 4 cannot test the Node adapter automatically); `getImageData` on a 640×360 canvas ×3 per frame on a phone (Task 6, watch the time per frame on the real phone); iOS Safari camera, motion permission and fullscreen behaviour (Lyndz's phone test).
