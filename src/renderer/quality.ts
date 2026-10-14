export interface Quality {
  /** Fraction of full canvas resolution, 0.5..1. */
  scale: number;
  fpsCap: 30 | 60;
}

const STEP = 0.1;
const MIN_SCALE = 0.5;
const RECOVER_WINDOWS = 5;
const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Watches frame times and sheds load before the phone's firmware does it for us:
 * resolution down in 0.1 steps to 0.5, then a 30fps cap. Resolution recovers
 * while still at 60fps; the 30fps cap never lifts within a session (prevents
 * flapping, because at a 30fps cap frame times always look "healthy").
 */
export class ThermalGuard {
  quality: Quality = { scale: 1, fpsCap: 60 };
  private sum = 0;
  private count = 0;
  private okStreak = 0;

  constructor(private windowSize = 60) {}

  push(frameMs: number): Quality {
    this.sum += frameMs;
    this.count++;
    if (this.count < this.windowSize) return this.quality;

    const avg = this.sum / this.count;
    this.sum = 0;
    this.count = 0;

    const q = this.quality;
    const budget = 1000 / q.fpsCap;
    if (avg > budget * 1.3) {
      this.okStreak = 0;
      if (q.scale > MIN_SCALE + 1e-9) this.quality = { ...q, scale: round1(q.scale - STEP) };
      else if (q.fpsCap === 60) this.quality = { scale: q.scale, fpsCap: 30 };
    } else if (avg < budget * 1.05 && q.fpsCap === 60 && q.scale < 1) {
      if (++this.okStreak >= RECOVER_WINDOWS) {
        this.okStreak = 0;
        this.quality = { ...q, scale: round1(Math.min(1, q.scale + STEP)) };
      }
    } else {
      this.okStreak = 0;
    }
    return this.quality;
  }
}
