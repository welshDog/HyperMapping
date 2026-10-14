export interface LoopHooks {
  draw(): void;
  onFrameTime?(ms: number): void;
}

type Raf = (cb: (t: number) => void) => number;
type Caf = (id: number) => void;

export class FrameLoop {
  fpsCap: 30 | 60 = 60;
  private id = 0;
  private lastDraw = -1;
  private running = false;

  constructor(
    private hooks: LoopHooks,
    private raf: Raf = (cb) => requestAnimationFrame(cb),
    private caf: Caf = (id) => cancelAnimationFrame(id),
  ) {}

  start() {
    if (this.running) return;
    this.running = true;
    this.lastDraw = -1;
    this.id = this.raf(this.tick);
  }

  stop() {
    this.running = false;
    this.caf(this.id);
  }

  private tick = (t: number) => {
    if (!this.running) return;
    this.id = this.raf(this.tick);
    const minGap = 1000 / this.fpsCap - 2; // tolerate vsync jitter
    if (this.lastDraw >= 0 && t - this.lastDraw < minGap) return;
    if (this.lastDraw >= 0) this.hooks.onFrameTime?.(t - this.lastDraw);
    this.lastDraw = t;
    this.hooks.draw();
  };
}
