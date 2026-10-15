const two = (n: number) => String(n).padStart(2, '0');

/** A default name for a saved calibration result, e.g. "Calibration 09:05" (local time). */
export function calibrationSetupName(when: Date): string {
  return `Calibration ${two(when.getHours())}:${two(when.getMinutes())}`;
}
