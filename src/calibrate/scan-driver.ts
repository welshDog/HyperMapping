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
