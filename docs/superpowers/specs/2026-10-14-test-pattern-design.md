# HyperMapping — Built-in test pattern Design Spec

Builds on the shipped Editor, Output window, virtual projector and glued corners.

## Context
Until a video is loaded the picture is black everywhere: the Editor canvas, the Output window and the simulator's box. That makes it impossible to line up pins, check slices, spot a mirrored picture, or see the simulator work without first finding a good video. Lyndz asked for a built-in test pattern.

Agreed with Lyndz: **everywhere, automatic.** A built-in pattern shows in the main app, the Output window and the simulator whenever no video is loaded. A **Test pattern** button in the Editor forces it on even when a video is loaded. Loading a video takes over unless the button is on. Out of scope: other pattern types (colour bars), a moving test video, saving the button state.

## The pattern
A generated 1280 × 720 (16:9) picture, never a file:
- fine grid with 16 columns × 9 rows, every 4th line heavier;
- column letters `A`–`P` along the top and row numbers `1`–`9` down the left, so a face's slice shows which part it received;
- large corner labels `TL`, `TR`, `BL`, `BR` and a `TOP` label with an up arrow;
- centre crosshair and a circle whose radius is 0.3 × the height (a squashed circle means a wrong shape);
- an asymmetric word, `HYPERMAPPING`, so a mirrored or flipped picture is obvious;
- one small dot in the bottom-right corner that toggles every 500 ms, proving the picture is live.

## How it reaches the renderers (no renderer changes)
Both renderers already draw an `HTMLVideoElement` through `Renderer.setVideo`. The pattern is drawn onto a hidden canvas and exposed as a live video: `canvas.captureStream(10)` assigned to a hidden, muted, `playsinline` `<video>` (attached to the body with the same hidden styling the video loader uses, never `display:none`). A 500 ms timer redraws the pattern (toggling the dot), which also keeps frames flowing. If `captureStream` is missing or throws, the source is `null` and the app behaves exactly as today (black).

## Pure module — `src/sources/pattern.ts`
- `PATTERN_WIDTH = 1280`, `PATTERN_HEIGHT = 720`.
- `type PatternContext = Pick<CanvasRenderingContext2D, 'fillStyle' | 'strokeStyle' | 'lineWidth' | 'font' | 'textAlign' | 'textBaseline' | 'fillRect' | 'strokeRect' | 'beginPath' | 'moveTo' | 'lineTo' | 'arc' | 'closePath' | 'stroke' | 'fill' | 'fillText'>` — the only drawing calls the pattern uses, so it can be tested with a recording stand-in.
- `drawTestPattern(ctx: PatternContext, width: number, height: number, tick: number): void` — draws the whole picture; the dot is on when `tick` is even.
- `wantsPattern(force: boolean, hasVideo: boolean): boolean` — `force || !hasVideo`.
- `createPatternSource(): PatternSource | null` where `interface PatternSource { video: HTMLVideoElement; ensurePlaying(): void; dispose(): void }` (DOM; not unit-tested). `dispose` clears the timer, stops the tracks, removes the element and clears `srcObject`. `ensurePlaying` calls `play()` if the element is paused, swallowing the rejection.

## Channel — `src/output/protocol.ts`
New message `{ type: 'pattern'; on: boolean }` (Editor → others). `parseMsg` accepts it only when `on` is a boolean. The Editor sends it when the button is toggled, in the `hello` reply, and in the creation broadcast, so a late-opened Output window or simulator matches.

## Editor — `src/ui/Editor.tsx`
- State `patternForce` (default `false`, not saved; mirrored in a ref for the channel effect). A pattern source is created in an effect once the renderer exists and disposed on unmount; its availability is kept in state so the button can be disabled with a short title when unsupported.
- One function applies the right source to the renderer: `renderer.setVideo(wantsPattern(force, hasVideo) ? pattern.video : videoHandle.video)`; with no pattern source and no video it sets `null` as today. It runs when the renderer/pattern become ready, when the button is toggled, and after a video loads.
- Toolbar button **Test pattern** (`aria-pressed`, ONE `bg-*` class per state, fixed minimum width, disabled when unsupported). `resumeVideo` also calls the pattern's `ensurePlaying`.

## Output window and simulator — `src/ui/useOutputFeed.ts`
The shared feed hook owns a pattern source and the `force` flag: it creates the source when the renderer exists, applies `wantsPattern(force, hasVideo)` whenever the renderer becomes ready, a video swaps in, or a `pattern` message arrives, and disposes the source in the existing cleanup. The Output window and the simulator both use the hook, so both gain the pattern with no other change. Visibility/pointer resume also nudges the pattern source.

## Edge cases (each tested where pure)
1. Every mark `drawTestPattern` makes lies inside `[0, width] × [0, height]` and the labels `TL`, `TR`, `BL`, `BR` and `TOP` are drawn (recording stand-in).
2. The dot toggles with `tick` parity.
3. `wantsPattern`: true when forced, true with no video, false only when a video is loaded and the button is off.
4. `parseMsg` accepts `{type:'pattern', on:true|false}` and rejects a missing, numeric or string `on`.
5. No `captureStream` (or it throws): the source is `null`; nothing throws; behaviour is as today.
6. Loading a video while the pattern is forced keeps showing the pattern until the button is turned off.
7. A late-opened Output window or simulator receives the current force state through `hello`.
8. Disposing the source stops its timer, tracks and element (no leak on unmount or renderer re-creation).

## Testing
- Unit (Vitest, Node): `drawTestPattern` against a recording context (bounds, labels, dot parity), `wantsPattern`, protocol `pattern` accept/reject.
- DOM parts (stream creation, Editor state, feed hook, button): `tsc` + `npm run build`, then a manual check: open the app with no video (pattern visible, dot blinking), load a video (video takes over), press Test pattern (pattern returns), open the Output window and the simulator (both show it), turn it off.

## Risks
- Browser support for `canvas.captureStream` and for drawing a stream-backed video to WebGL/WebGPU: expected on current Chrome/Edge/Firefox/Safari, but the graceful fallback is black, as today. This is the main thing the manual check must confirm on the phone.
- A backgrounded tab can pause the stream: tapping or returning to the page resumes it.
- A second hidden `<video>` per page (Editor, Output, simulator) and a 2 fps redraw: negligible CPU/memory.
