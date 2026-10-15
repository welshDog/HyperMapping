export interface ScanGate {
  /** Record that the phone confirmed frame `i`; only the next expected frame counts. */
  frameDone(i: number): void;
  /** True only once every frame of THIS scan has been confirmed in order. */
  canAcceptResult(): boolean;
}

/** One gate per scan: a scan-result is believable only after the phone confirmed all `total` frames of this scan. */
export function createScanGate(total: number): ScanGate {
  let done = 0;
  return {
    frameDone(i) {
      if (i === done && done < total) done++;
    },
    canAcceptResult: () => total > 0 && done === total,
  };
}
