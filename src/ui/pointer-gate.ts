export interface PointerGate {
  /** A finger went down on a pin. True if it now owns the drag; false if another finger already does. */
  down(pointerId: number): boolean;
  /** True while this finger owns the drag. */
  owns(pointerId: number): boolean;
  /** A finger lifted. True only if it was the owner (and the gate is free again). */
  up(pointerId: number): boolean;
  /** Drop whatever drag is active (e.g. the selected face changed). True if there was one. */
  reset(): boolean;
}

/** One drag at a time: the first finger down owns it, every other finger is ignored until it lifts. */
export function createPointerGate(): PointerGate {
  let owner: number | null = null;
  return {
    down(pointerId) {
      if (owner !== null) return false;
      owner = pointerId;
      return true;
    },
    owns: (pointerId) => owner === pointerId,
    up(pointerId) {
      if (owner !== pointerId) return false;
      owner = null;
      return true;
    },
    reset() {
      const was = owner !== null;
      owner = null;
      return was;
    },
  };
}
