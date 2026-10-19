/** The distinct non-null sources used by the faces in `order`, in first-use order (one upload each per frame). */
export function distinctVideos<T>(order: readonly string[], pick: (id: string) => T | null): T[] {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const id of order) {
    const v = pick(id);
    if (v === null || v === undefined || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}
