# HyperMapping Test Pattern Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A built-in test pattern (grid, lettered columns, numbered rows, corner labels, TOP arrow, circle, asymmetric word, blinking dot) that shows in the Editor, the Output window and the simulator whenever no video is loaded, with a **Test pattern** toolbar button that forces it on even when a video is loaded.

**Architecture:** The pattern is drawn onto a hidden canvas and exposed as a live video through `canvas.captureStream()`, so both renderers draw it through the existing `Renderer.setVideo` path with NO renderer changes. A small pure module draws it and decides when to use it; a new `pattern` channel message tells the other windows whether the Editor's button is on; the Editor and the shared `useOutputFeed` hook each pick "pattern or video" with one function. If the browser cannot make the stream the source is `null` and everything behaves as today (black).

**Tech Stack:** React 18, TypeScript 5.9 (strict), Vitest 2 (Node env), Canvas 2D, MediaStream.

**Spec:** `docs/superpowers/specs/2026-10-14-test-pattern-design.md`

## Global Constraints

- Pattern size `PATTERN_WIDTH = 1280`, `PATTERN_HEIGHT = 720` (16:9); grid 16 columns × 9 rows; the blinking dot is ON when `tick` is even; the redraw timer is 500 ms; `captureStream(10)`.
- The pattern is shown when `wantsPattern(force, hasVideo)` = `force || !hasVideo`. Loading a video while forced keeps the pattern until the button is turned off.
- The pattern's `<video>` is muted, `playsinline`, appended to the body with the same hidden styling the video loader uses (`position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px`), NEVER `display:none`.
- `createPatternSource()` returns `null` (never throws) when `captureStream` or the 2D context is unavailable.
- Channel message `{ type: 'pattern'; on: boolean }` (Editor → others); `parseMsg` accepts it only when `on` is a boolean. The Editor sends it when the button is toggled, in the `hello` reply and in the creation broadcast.
- No renderer or shader changes. Existing behaviour unchanged: loading/swapping videos, the late-load guard, disposal order, resume-on-tap, the face/slice/glue/setups features, the simulator.
- A single `bg-*` colour class per element (two make the later CSS rule win; zinc beats cyan).
- Every commit passes `npx tsc --noEmit`, `npm test`, `npm run build`; the test count only goes up. Commit messages end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never `git add` anything under `.superpowers/`.
- Working directory for every command: `h:\HYPERFOCUSZONE\HperCore\HyperMapping`. The machine is short of RAM: do not start a dev server; verify with tsc, vitest and the build only.

## Review Focus

1. **Unsupported browsers degrade to today's behaviour**: no `captureStream` or no 2D context gives `null`, nothing throws, the button is disabled, the picture stays black. Read in Task 3's review.
2. **The picture is correct**: every mark lies inside the canvas, the corner/TOP/word labels are drawn, the dot toggles with tick parity, and it scales to other sizes. Tested in Task 1.
3. **Source selection is consistent and old video flows are unchanged**: Editor and feed use the same `wantsPattern`; loading and swapping a video, the out-of-order guard, disposal order and cleanup still behave exactly as before. Read in Task 3's review.
4. **Late-opened windows match**: the `hello` reply and creation broadcast carry the force state; `parseMsg` rejects malformed `pattern` messages. Tested in Task 2; wiring read in Task 3.
5. **No leaks**: the timer, tracks, hidden element and `srcObject` are released on unmount and when the renderer is re-created. Read in Task 3's review.

---

## File Structure

```
src/sources/pattern.ts          drawTestPattern, wantsPattern, createPatternSource (+ pattern.test.ts)
src/output/protocol.ts          + 'pattern' message (+ protocol.test.ts additions)
src/ui/useOutputFeed.ts         owns a pattern source; applies pattern-or-video (full replacement)
src/ui/Editor.tsx               pattern source, force state, Test pattern button, messages
README.md                       bullet in "Use"
```

---

### Task 1: The pattern module

**Files:**
- Create: `src/sources/pattern.ts`
- Test: `src/sources/pattern.test.ts`

**Interfaces:**
- Produces: `PATTERN_WIDTH`, `PATTERN_HEIGHT`, `type PatternContext`, `drawTestPattern(ctx, width, height, tick): void`, `wantsPattern(force, hasVideo): boolean`, `interface PatternSource { video; ensurePlaying(); dispose() }`, `createPatternSource(): PatternSource | null`.

- [ ] **Step 1: Write the failing test**

`src/sources/pattern.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { PATTERN_HEIGHT, PATTERN_WIDTH, drawTestPattern, wantsPattern, type PatternContext } from './pattern';

/** Records every drawing call so the pattern can be checked without a canvas. */
class Recorder implements PatternContext {
  fillStyle: string | CanvasGradient | CanvasPattern = '';
  strokeStyle: string | CanvasGradient | CanvasPattern = '';
  lineWidth = 1;
  font = '';
  textAlign: CanvasTextAlign = 'start';
  textBaseline: CanvasTextBaseline = 'alphabetic';
  /** Every point the drawing touches: [x, y]. */
  points: [number, number][] = [];
  texts: string[] = [];
  fillStyles: string[] = []; // fillStyle at each fill()
  fillRect(x: number, y: number, w: number, h: number) {
    this.points.push([x, y], [x + w, y + h]);
  }
  strokeRect(x: number, y: number, w: number, h: number) {
    this.points.push([x, y], [x + w, y + h]);
  }
  beginPath() {}
  closePath() {}
  moveTo(x: number, y: number) {
    this.points.push([x, y]);
  }
  lineTo(x: number, y: number) {
    this.points.push([x, y]);
  }
  arc(x: number, y: number, r: number) {
    this.points.push([x - r, y - r], [x + r, y + r]);
  }
  stroke() {}
  fill() {
    this.fillStyles.push(String(this.fillStyle));
  }
  fillText(text: string, x: number, y: number) {
    this.texts.push(text);
    this.points.push([x, y]);
  }
}

const draw = (w = PATTERN_WIDTH, h = PATTERN_HEIGHT, tick = 0) => {
  const r = new Recorder();
  drawTestPattern(r, w, h, tick);
  return r;
};

describe('drawTestPattern', () => {
  it('keeps every mark inside the picture', () => {
    for (const [w, h] of [
      [1280, 720],
      [640, 360],
      [320, 180],
    ] as const) {
      const r = draw(w, h);
      expect(r.points.length).toBeGreaterThan(50);
      for (const [x, y] of r.points) {
        expect(x).toBeGreaterThanOrEqual(-1e-9);
        expect(x).toBeLessThanOrEqual(w + 1e-9);
        expect(y).toBeGreaterThanOrEqual(-1e-9);
        expect(y).toBeLessThanOrEqual(h + 1e-9);
      }
    }
  });

  it('labels the corners, the top, the columns, the rows and the asymmetric word', () => {
    const { texts } = draw();
    for (const t of ['TL', 'TR', 'BL', 'BR', 'TOP', 'HYPERMAPPING']) expect(texts).toContain(t);
    for (const c of 'BCDEFGHIJKLMNO') expect(texts).toContain(c); // columns B..O (A and P are corner cells)
    for (const n of '2345678') expect(texts).toContain(n); // rows 2..8 (1 and 9 are corner cells)
  });

  it('is deterministic for the same tick', () => {
    expect(draw(1280, 720, 4).texts).toEqual(draw(1280, 720, 4).texts);
    expect(draw(1280, 720, 4).points).toEqual(draw(1280, 720, 4).points);
  });

  it('blinks the live dot with tick parity (the dot is the last thing drawn)', () => {
    const last = (tick: number) => {
      const s = draw(1280, 720, tick).fillStyles;
      return s[s.length - 1];
    };
    expect(last(0)).toBe(last(2));
    expect(last(1)).toBe(last(3));
    expect(last(0)).not.toBe(last(1));
  });
});

describe('wantsPattern', () => {
  it('shows the pattern when forced or when there is no video', () => {
    expect(wantsPattern(true, true)).toBe(true);
    expect(wantsPattern(true, false)).toBe(true);
    expect(wantsPattern(false, false)).toBe(true);
  });
  it('shows the video only when one is loaded and the button is off', () => {
    expect(wantsPattern(false, true)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/sources/pattern.test.ts`
Expected: FAIL — `./pattern` not found.

- [ ] **Step 3: Implement**

`src/sources/pattern.ts`:
```ts
export const PATTERN_WIDTH = 1280;
export const PATTERN_HEIGHT = 720;

const COLS = 16;
const ROWS = 9;
const LETTERS = 'ABCDEFGHIJKLMNOP';
const TICK_MS = 500;
/** Off-screen but NOT display:none, so mobile browsers keep producing frames. */
const HIDDEN_STYLE = 'position:fixed;width:1px;height:1px;opacity:0;pointer-events:none;left:-10px;top:-10px';

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
  try {
    const canvas = document.createElement('canvas');
    canvas.width = PATTERN_WIDTH;
    canvas.height = PATTERN_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx || typeof canvas.captureStream !== 'function') return null;

    let tick = 0;
    drawTestPattern(ctx, PATTERN_WIDTH, PATTERN_HEIGHT, tick);
    const stream = canvas.captureStream(10);

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.style.cssText = HIDDEN_STYLE;
    video.srcObject = stream;
    document.body.appendChild(video);

    const ensurePlaying = () => {
      if (video.paused) video.play().catch(() => {});
    };
    ensurePlaying();

    // Redrawing (the dot toggles) keeps frames flowing through the stream.
    const timer = window.setInterval(() => {
      tick += 1;
      drawTestPattern(ctx, PATTERN_WIDTH, PATTERN_HEIGHT, tick);
    }, TICK_MS);

    return {
      video,
      ensurePlaying,
      dispose() {
        window.clearInterval(timer);
        stream.getTracks().forEach((track) => track.stop());
        video.pause();
        video.srcObject = null;
        video.remove();
      },
    };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/sources && npx tsc --noEmit && npm test`
Expected: PASS. `createPatternSource` touches the DOM and has no unit test (Node env): say so in the report. If the bounds test fails for a particular mark (for example a label at an edge), adjust the DRAWING (not the test) so the mark is inside the picture, and report exactly what you changed.

- [ ] **Step 5: Commit**

```bash
git add src/sources/pattern.ts src/sources/pattern.test.ts
git commit -m "feat(sources): built-in test pattern (drawing, source selection, live stream)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: The `pattern` channel message

**Files:**
- Modify: `src/output/protocol.ts`, `src/output/protocol.test.ts`

**Interfaces:**
- Produces: `Msg` gains `{ type: 'pattern'; on: boolean }`; `parseMsg` accepts it only when `on` is a boolean.

- [ ] **Step 1: Write the failing tests**

Add inside the existing `describe('parseMsg', ...)` in `src/output/protocol.test.ts`:
```ts
  it('accepts a pattern message with a boolean flag', () => {
    expect(parseMsg({ type: 'pattern', on: true })).toEqual({ type: 'pattern', on: true });
    expect(parseMsg({ type: 'pattern', on: false })).toEqual({ type: 'pattern', on: false });
  });
  it('rejects a pattern message whose flag is missing or not a boolean', () => {
    expect(parseMsg({ type: 'pattern' })).toBeNull();
    expect(parseMsg({ type: 'pattern', on: 1 })).toBeNull();
    expect(parseMsg({ type: 'pattern', on: 'true' })).toBeNull();
    expect(parseMsg({ type: 'pattern', on: null })).toBeNull();
  });
  it('drops unknown fields from a pattern message', () => {
    expect(parseMsg({ type: 'pattern', on: true, evil: 1 })).toEqual({ type: 'pattern', on: true });
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/output`
Expected: FAIL — the `pattern` type returns `null`.

- [ ] **Step 3: Implement**

In `src/output/protocol.ts`:
1. Add this variant to the `Msg` union (before the `video` variant):
```ts
  | { type: 'pattern'; on: boolean } // editor -> others: show the test pattern even when a video is loaded
```
2. Add this case in `parseMsg` immediately before `case 'video':`:
```ts
    case 'pattern':
      return typeof d.on === 'boolean' ? { type: 'pattern', on: d.on } : null;
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/output && npx tsc --noEmit && npm test`
Expected: PASS. (Adding a `Msg` variant must not break existing consumers: `Output`/feed/Editor narrow on `msg.type`; if `tsc` reports an error, fix it minimally and report it.)

- [ ] **Step 5: Commit**

```bash
git add src/output
git commit -m "feat(output): pattern channel message

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Wire the pattern into the feed hook and the Editor

**Files:**
- Modify (full replacement): `src/ui/useOutputFeed.ts`
- Modify: `src/ui/Editor.tsx` (anchored edits below), `README.md`

**Interfaces:**
- Consumes: `createPatternSource`, `wantsPattern`, `PatternSource` (Task 1); the `pattern` message (Task 2).
- Produces: pattern behaviour in the Output window, the simulator (both via the feed hook) and the Editor.

UI wiring has no unit tests (Node env, no DOM). Verification is `tsc`, the full `npm test`, `npm run build`; say so explicitly.

- [ ] **Step 1: Replace `src/ui/useOutputFeed.ts` with**
```ts
import { useCallback, useEffect, useRef } from 'react';
import { CHANNEL, parseMsg } from '../output/protocol';
import type { Renderer } from '../renderer';
import { createPatternSource, wantsPattern, type PatternSource } from '../sources/pattern';
import { createVideoFromBlob, type VideoHandle } from '../sources/video';
import type { Surface } from '../surfaces/types';

/**
 * Connects a renderer to the editor over the channel, exactly like the Output window always did:
 * says `hello`, applies the face lists it receives and plays the video it receives. If `onSurfaces`
 * is given it is called INSTEAD of `renderer.setSurfaces` (the simulator uses this to ignore the
 * app's faces while it shows its own layout).
 *
 * It also owns a built-in test pattern: shown whenever no video is loaded, or when the Editor's
 * Test pattern button is on (a `pattern` message), so the Output window and the simulator are never
 * just black.
 */
export function useOutputFeed(renderer: Renderer | null, onSurfaces?: (surfaces: Surface[]) => void) {
  const handleRef = useRef<VideoHandle | null>(null);
  const patternRef = useRef<PatternSource | null>(null);
  const onSurfacesRef = useRef(onSurfaces);
  onSurfacesRef.current = onSurfaces;

  // A refused autoplay or a backgrounded tab leaves the video paused on one frame.
  const resumeVideo = useCallback(() => {
    const v = handleRef.current?.video;
    if (v?.paused) v.play().catch(() => {});
    patternRef.current?.ensurePlaying();
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') resumeVideo();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [resumeVideo]);

  useEffect(() => {
    if (!renderer) return;
    const ch = new BroadcastChannel(CHANNEL);
    let latest = 0; // guards against out-of-order async video loads
    let force = false; // the Editor's Test pattern button
    const pattern = createPatternSource(); // null when the browser cannot make it
    patternRef.current = pattern;

    /** Give the renderer the pattern or the video, whichever should be showing. */
    const apply = () => {
      const video = handleRef.current;
      const source = wantsPattern(force, video !== null) && pattern ? pattern.video : video ? video.video : null;
      renderer.setVideo(source);
    };
    apply();

    ch.onmessage = async (ev) => {
      const msg = parseMsg(ev.data);
      if (!msg) return;
      if (msg.type === 'surfaces') {
        if (onSurfacesRef.current) onSurfacesRef.current(msg.surfaces);
        else renderer.setSurfaces(msg.surfaces);
      } else if (msg.type === 'pattern') {
        force = msg.on;
        apply();
      } else if (msg.type === 'video') {
        const mine = ++latest;
        try {
          const next = await createVideoFromBlob(msg.blob);
          if (mine !== latest) {
            next.dispose();
            return;
          }
          const previous = handleRef.current;
          handleRef.current = next;
          try {
            apply();
          } catch (e) {
            handleRef.current = previous;
            next.dispose(); // never leak a video the renderer refused
            throw e;
          }
          // Swap only after the renderer holds the new source, so it never draws a disposed video.
          previous?.dispose();
        } catch (e) {
          console.warn('[hypermapping] output could not load video', e);
        }
      }
    };
    ch.postMessage({ type: 'hello' });

    return () => {
      ch.close();
      latest++; // a load still in flight is now stale: it disposes itself instead of being assigned
      handleRef.current?.dispose();
      handleRef.current = null;
      pattern?.dispose();
      patternRef.current = null;
      renderer.setVideo(null);
    };
  }, [renderer]);

  return { resumeVideo };
}
```

- [ ] **Step 2: Editor edits (`src/ui/Editor.tsx`)** — apply against the live file; if an anchor differs, adapt minimally and report it.

1. After `import { createVideoFromBlob, type VideoHandle } from '../sources/video';` add:
```ts
import { createPatternSource, wantsPattern, type PatternSource } from '../sources/pattern';
```
2. After `const blobRef = useRef<Blob | null>(null);` add:
```ts
  const patternRef = useRef<PatternSource | null>(null);
  const [patternAvailable, setPatternAvailable] = useState(true); // false when the browser cannot make the pattern
  const [patternForce, setPatternForce] = useState(false); // show the pattern even when a video is loaded; not saved
  const patternForceRef = useRef(false); // read by the channel effect and applySource
```
3. Immediately after the effect
```tsx
  useEffect(() => {
    renderer?.setSurfaces(surfacesRef.current);
  }, [renderer]);
```
add:
```tsx
  /** Give the renderer the test pattern or the video, whichever should be showing. */
  const applySource = useCallback(() => {
    if (!renderer) return;
    const pattern = patternRef.current;
    const video = videoRef.current;
    const source = wantsPattern(patternForceRef.current, video !== null) && pattern ? pattern.video : video ? video.video : null;
    renderer.setVideo(source);
  }, [renderer]);

  // The test pattern source lives as long as the renderer; it is shown while there is no video.
  useEffect(() => {
    if (!renderer) return;
    const source = createPatternSource();
    patternRef.current = source;
    setPatternAvailable(source !== null);
    applySource();
    return () => {
      source?.dispose();
      if (patternRef.current === source) patternRef.current = null;
    };
  }, [renderer, applySource]);

  const togglePattern = () => {
    const next = !patternForce;
    patternForceRef.current = next;
    setPatternForce(next);
    channelRef.current?.postMessage({ type: 'pattern', on: next });
    applySource();
  };
```
4. In `resumeVideo`, after the line `if (v?.paused) v.play().catch(() => {});` add `    patternRef.current?.ensurePlaying();`.
5. In the channel effect, add the pattern flag to BOTH places that post the surfaces:
   - in the hello reply, after `ch.postMessage({ type: 'surfaces', surfaces: surfacesRef.current });` (the one followed by `if (blobRef.current) ...`) add `      ch.postMessage({ type: 'pattern', on: patternForceRef.current });`
   - in the creation broadcast, after the second `ch.postMessage({ type: 'surfaces', surfaces: surfacesRef.current });` add `    ch.postMessage({ type: 'pattern', on: patternForceRef.current });`
6. In `onFile`, replace `renderer.setVideo(handle.video);` with `applySource();` (the handle is already stored in `videoRef.current` on the lines above).
7. In the toolbar, right after the Glue button add (exactly ONE `bg-*` class per state):
```tsx
          <button
            aria-pressed={patternForce}
            disabled={!patternAvailable}
            title={patternAvailable ? undefined : 'Not supported in this browser'}
            className={`rounded-lg px-4 py-3 font-medium min-w-[9rem] disabled:opacity-40 ${patternForce ? 'bg-cyan-500 text-black' : 'bg-zinc-700'}`}
            onClick={togglePattern}
          >
            Test pattern: {patternForce ? 'on' : 'off'}
          </button>
```

- [ ] **Step 3: README**

Add this bullet to the end of the "Use" list:
```markdown
- With no video loaded the app shows a built-in **test pattern** (a grid with lettered columns and numbered rows, corner labels, a TOP arrow, a circle, a word that reads wrong if mirrored, and a blinking dot that shows it is live), in the app, the Output window and the simulator, so you can line up pins and check slices without a video. **Test pattern** in the toolbar forces it on even when a video is loaded. If your browser cannot make it, the button is greyed out and the picture stays black until you load a video.
```

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit && npm test && npm run build`
Expected: all pass; no new unit tests in this task (React/DOM). In the report include a read-through list confirming: `useOutputFeed` still says `hello` after `onmessage` is assigned; the late-load guard, the stale-load disposal, the refused-source disposal and the previous-handle disposal AFTER the renderer holds the new source are preserved; cleanup order (close channel, `latest++`, dispose handle, dispose pattern, `setVideo(null)`); `apply()` is used for every source change; the Editor's effect cleanup disposes the pattern and nulls the ref; the Editor's `onFile` stores `videoRef.current` BEFORE `applySource()`; the `pattern` message is sent on toggle, hello reply and creation broadcast; the Test pattern button has exactly one `bg-*` class per state and is disabled when unsupported; nothing throws when `createPatternSource()` returns null (video-less state sets `null` as before).
```bash
git add src/ui/useOutputFeed.ts src/ui/Editor.tsx README.md
git commit -m "feat(ui): test pattern in the Editor, Output window and simulator, with a force button

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** the picture and its contents (Task 1); `wantsPattern` (Task 1); the live stream source with graceful null (Task 1); the `pattern` message (Task 2); the Editor's source selection, force button, disabled-when-unsupported, resume nudge, hello/creation broadcast (Task 3); the Output window and simulator via the shared feed hook (Task 3); README (Task 3). Spec edge cases 1-8: 1-4 are unit-tested (Tasks 1-2); 5-8 are read in Task 3's review.

**Placeholder scan:** none; every step carries full code.

**Type consistency:** `PATTERN_WIDTH`, `PATTERN_HEIGHT`, `PatternContext`, `drawTestPattern`, `wantsPattern`, `PatternSource`, `createPatternSource`, the `pattern` message `{ type, on }`, `applySource`, `patternForceRef` are spelled identically wherever used.

**Known risks to watch at execution time:** the Recorder stand-in must satisfy `PatternContext` under strict TypeScript (property types such as `CanvasTextAlign`); the bounds test depends on the layout maths (corner labels at cell centres, the dot at `(width - 16, height - 16)`); in the feed hook, replacing the old `renderer.setVideo(next.video)` block must keep the "previous handle disposed only after the renderer holds the new source" guarantee.
