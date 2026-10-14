export interface LoopHooks {
  draw(): void;
  onFrameTime?(ms: number): void;
}

type Raf = (cb: (t: number) => void) => number;
type Caf = (id: number) => void;

/** A gap this long means the page was hidden (file picker, app switch): a resume, not a slow frame. */
const RESUME_GAP_MS = 250;
/**
 * Bounds for the display-period estimate. The upper bound is one 60 Hz vsync on
 * purpose: a phone whose draw is too slow makes EVERY rAF callback land a vsync
 * late, so raw deltas alone cannot tell "slow 60 Hz device" from "30 Hz display".
 * Assuming at least 60 Hz keeps slow devices visible to the ThermalGuard.
 */
const MIN_PERIOD_MS = 4;
const MAX_PERIOD_MS = 1000 / 60;
/** The period estimate is the min raw delta over the last 1..2 blocks of ticks. */
const PERIOD_BLOCK = 120;

export class FrameLoop {
  fpsCap: 30 | 60 = 60;
  private id = 0;
  private lastDraw = -1;
  private lastTick = -1;
  private running = false;
  // Rolling minimum of raw rAF deltas: min(previous block, current block).
  private blockMin = Infinity;
  private prevBlockMin = Infinity;
  private blockCount = 0;

  constructor(
    private hooks: LoopHooks,
    private raf: Raf = (cb) => requestAnimationFrame(cb),
    private caf: Caf = (id) => cancelAnimationFrame(id),
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.lastDraw = -1;
    this.resetPeriod();
    this.id = this.raf(this.tick);
  }

  stop() {
    this.running = false;
    this.caf(this.id);
  }

  private resetPeriod() {
    this.lastTick = -1;
    this.blockMin = Infinity;
    this.prevBlockMin = Infinity;
    this.blockCount = 0;
  }

  private notePeriod(delta: number) {
    if (delta < this.blockMin) this.blockMin = delta;
    if (++this.blockCount >= PERIOD_BLOCK) {
      this.prevBlockMin = this.blockMin;
      this.blockMin = Infinity;
      this.blockCount = 0;
    }
  }

  /** Best guess at the display's vsync period, clamped to [4, 16.67] ms. */
  private period(): number {
    const p = Math.min(this.blockMin, this.prevBlockMin);
    if (!Number.isFinite(p)) return MAX_PERIOD_MS;
    return Math.min(MAX_PERIOD_MS, Math.max(MIN_PERIOD_MS, p));
  }

  private tick = (t: number) => {
    if (!this.running) return;
    this.id = this.raf(this.tick);

    if (this.lastDraw >= 0 && t - this.lastDraw > RESUME_GAP_MS) {
      // Back from a hidden tab: draw now, but this gap says nothing about GPU load.
      this.resetPeriod();
      this.lastTick = t;
      this.lastDraw = t;
      this.hooks.draw();
      return;
    }

    if (this.lastTick >= 0) this.notePeriod(t - this.lastTick);
    this.lastTick = t;

    const budget = 1000 / this.fpsCap;
    const minGap = budget - 2; // tolerate vsync jitter
    if (this.lastDraw >= 0 && t - this.lastDraw < minGap) return;
    if (this.lastDraw >= 0) {
      // On a 90/120/144 Hz display the cap can only be met on whole vsyncs, so a
      // healthy draw interval is `expected`, not `budget`. Normalise to the budget
      // so the ThermalGuard sees ~budget on any healthy display.
      const p = this.period();
      const expected = Math.ceil(minGap / p) * p;
      this.hooks.onFrameTime?.(((t - this.lastDraw) * budget) / expected);
    }
    this.lastDraw = t;
    this.hooks.draw();
  };
}
