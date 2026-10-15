import { describe, it, expect } from 'vitest';
import { NAME_MAX, normalizeName } from '../setups/setups';
import { calibrationSetupName } from './names';

describe('calibrationSetupName', () => {
  it('pads hours and minutes', () => {
    expect(calibrationSetupName(new Date(2026, 9, 15, 9, 5))).toBe('Calibration 09:05');
    expect(calibrationSetupName(new Date(2026, 9, 15, 23, 59))).toBe('Calibration 23:59');
    expect(calibrationSetupName(new Date(2026, 9, 15, 0, 0))).toBe('Calibration 00:00');
  });
  it('is always a valid setup name', () => {
    const name = calibrationSetupName(new Date(2026, 0, 1, 12, 30));
    expect(name.length).toBeLessThanOrEqual(NAME_MAX);
    expect(normalizeName(name)).toBe(name);
  });
});
