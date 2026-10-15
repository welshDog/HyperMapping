import { createStreamVideo, type StreamVideo } from './stream-video';

export const PATTERN_WIDTH = 1280;
export const PATTERN_HEIGHT = 720;

const COLS = 16;
const ROWS = 9;
const LETTERS = 'ABCDEFGHIJKLMNOP';
const TICK_MS = 500;

/** The only drawing calls the pattern uses, so a recording stand-in can test it without a canvas. */
export type PatternContext = Pick<
  CanvasRenderingContext2D,
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'font'
  | 'textAlign'
  | 'textBaseline'
  | 'fillRect'
  | 'strokeRect'
  | 'beginPath'
  | 'moveTo'
  | 'lineTo'
  | 'arc'
  | 'closePath'
  | 'stroke'
  | 'fill'
  | 'fillText'
>;

/**
 * Draw the calibration picture: a grid (16 x 9) with lettered columns and numbered rows, corner
 * labels, a TOP arrow, a centre crosshair, a circle (a squashed circle means a wrong shape), an
 * asymmetric word (so a mirrored picture is obvious) and, last of all, a small dot that blinks
 * with `tick` to show the picture is live (on when `tick` is even).
 */
export function drawTestPattern(ctx: PatternContext, width: number, height: number, tick: number): void {
  const cw = width / COLS;
  const ch = height / ROWS;

  // Background and a faint checker so every cell is visible.
  ctx.fillStyle = '#0b0f1a';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#121a2c';
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if ((r + c) % 2 === 0) ctx.fillRect(c * cw, r * ch, cw, ch);
    }
  }

  // Grid lines: heavier every 4th column and every 3rd row.
  for (let c = 0; c <= COLS; c++) {
    const heavy = c % 4 === 0;
    ctx.strokeStyle = heavy ? '#6b7a99' : '#2c3850';
    ctx.lineWidth = heavy ? 3 : 1;
    ctx.beginPath();
    ctx.moveTo(c * cw, 0);
    ctx.lineTo(c * cw, height);
    ctx.stroke();
  }
  for (let r = 0; r <= ROWS; r++) {
    const heavy = r % 3 === 0;
    ctx.strokeStyle = heavy ? '#6b7a99' : '#2c3850';
    ctx.lineWidth = heavy ? 3 : 1;
    ctx.beginPath();
    ctx.moveTo(0, r * ch);
    ctx.lineTo(width, r * ch);
    ctx.stroke();
  }

  // Column letters (B..O) along the top and bottom rows, row numbers (2..8) down the left and
  // right columns. The corner cells carry the corner labels instead.
  ctx.fillStyle = '#9fb3d9';
  ctx.font = `${Math.round(ch * 0.3)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let c = 1; c < COLS - 1; c++) {
    ctx.fillText(LETTERS[c], c * cw + cw / 2, ch * 0.5);
    ctx.fillText(LETTERS[c], c * cw + cw / 2, height - ch * 0.5);
  }
  for (let r = 1; r < ROWS - 1; r++) {
    ctx.fillText(String(r + 1), cw * 0.5, r * ch + ch / 2);
    ctx.fillText(String(r + 1), width - cw * 0.5, r * ch + ch / 2);
  }

  // Corner labels, each in its own colour.
  ctx.font = `bold ${Math.round(ch * 0.42)}px sans-serif`;
  const corners: [string, number, number, string][] = [
    ['TL', cw * 0.5, ch * 0.5, '#f472b6'],
    ['TR', width - cw * 0.5, ch * 0.5, '#a3e635'],
    ['BL', cw * 0.5, height - ch * 0.5, '#fb923c'],
    ['BR', width - cw * 0.5, height - ch * 0.5, '#a78bfa'],
  ];
  for (const [label, x, y, color] of corners) {
    ctx.fillStyle = color;
    ctx.fillText(label, x, y);
  }

  // TOP label with an up arrow, in the second row.
  ctx.fillStyle = '#facc15';
  ctx.beginPath();
  ctx.moveTo(width / 2, ch * 1.05);
  ctx.lineTo(width / 2 - cw * 0.35, ch * 1.45);
  ctx.lineTo(width / 2 + cw * 0.35, ch * 1.45);
  ctx.closePath();
  ctx.fill();
  ctx.fillText('TOP', width / 2, ch * 1.8);

  // Centre crosshair and a circle (radius 0.3 of the height).
  ctx.strokeStyle = '#22d3ee';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width / 2 - cw, height / 2);
  ctx.lineTo(width / 2 + cw, height / 2);
  ctx.moveTo(width / 2, height / 2 - ch);
  ctx.lineTo(width / 2, height / 2 + ch);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(width / 2, height / 2, height * 0.3, 0, Math.PI * 2);
  ctx.stroke();

  // An asymmetric word: mirrored or flipped, it reads wrong.
  ctx.fillStyle = '#e5e7eb';
  ctx.font = `bold ${Math.round(ch * 0.7)}px sans-serif`;
  ctx.fillText('HYPERMAPPING', width / 2, height * 0.78);

  // The live dot goes last: on for even ticks, dark for odd ones.
  ctx.fillStyle = tick % 2 === 0 ? '#22d3ee' : '#0b0f1a';
  ctx.beginPath();
  ctx.arc(width - 16, height - 16, 8, 0, Math.PI * 2);
  ctx.fill();
}

/** The pattern is shown when forced, or when there is no video to show. */
export function wantsPattern(force: boolean, hasVideo: boolean): boolean {
  return force || !hasVideo;
}

export interface PatternSource {
  /** A live, muted video of the pattern: hand it to `Renderer.setVideo`. */
  video: HTMLVideoElement;
  /** Restart the stream if the browser paused it (backgrounded tab). */
  ensurePlaying(): void;
  /** Stop the timer and tracks and remove the element. */
  dispose(): void;
}

/**
 * Draw the pattern on a hidden canvas and expose it as a live video. Returns null (never throws)
 * when the browser cannot do that, in which case the app simply stays black until a video loads.
 */
export function createPatternSource(): PatternSource | null {
  let sv: StreamVideo | null = null;
  let timer: number | null = null;
  const release = () => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    sv?.dispose();
  };
  try {
    const canvas = document.createElement('canvas');
    canvas.width = PATTERN_WIDTH;
    canvas.height = PATTERN_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof canvas.captureStream !== 'function') return null;

    let tick = 0;
    drawTestPattern(ctx, PATTERN_WIDTH, PATTERN_HEIGHT, tick);
    sv = createStreamVideo(canvas, 10);
    if (!sv) return null;

    // Redrawing (the dot toggles) keeps frames flowing through the stream.
    timer = window.setInterval(() => {
      try {
        tick += 1;
        drawTestPattern(ctx, PATTERN_WIDTH, PATTERN_HEIGHT, tick);
      } catch {
        if (timer !== null) window.clearInterval(timer);
        timer = null;
      }
    }, TICK_MS);

    return { video: sv.video, ensurePlaying: sv.ensurePlaying, dispose: release };
  } catch {
    release();
    return null;
  }
}
