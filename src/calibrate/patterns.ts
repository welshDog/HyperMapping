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
