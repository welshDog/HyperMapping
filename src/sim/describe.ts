import type { SolveResult } from './solve';

/** Plain-English summary of a solve, one line per thing worth telling the user. */
export function describeSolve(r: SolveResult): string[] {
  const lines: string[] = [];
  if (r.faces.length === 0) {
    lines.push('No faces are visible from this projector position.');
  } else {
    const names = [...r.faces].sort((a, b) => a.centroidX - b.centroidX).map((f) => f.face);
    lines.push(`Faces used (left to right): ${names.join(', ')}`);
  }
  const partly = r.faces.filter((f) => f.partlyOutside).map((f) => f.face);
  if (partly.length) lines.push(`Partly outside the projector image: ${partly.join(', ')}`);
  for (const s of r.skipped) {
    if (s.reason === 'behind-projector') lines.push(`Skipped ${s.face}: behind the projector.`);
    else if (s.reason === 'off-image') {
      lines.push(`Skipped ${s.face}: too far outside the image (widen the throw ratio or move back).`);
    } else if (s.reason === 'degenerate') {
      lines.push(`Skipped ${s.face}: edge-on or too small to map from here.`);
    }
    // 'facing-away' is the normal case for the back of a box: not worth a line.
  }
  return lines;
}
