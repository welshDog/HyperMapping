import { useMemo } from 'react';
import { qrPath } from '../calibrate/qr';

/** A QR code drawn as one SVG path (no images, nothing fetched). */
export function QrCode({ text, className }: { text: string; className?: string }) {
  const { size, d } = useMemo(() => qrPath(text), [text]);
  return (
    <svg viewBox={`-2 -2 ${size + 4} ${size + 4}`} className={className} shapeRendering="crispEdges" role="img" aria-label="QR code for the camera link">
      <rect x={-2} y={-2} width={size + 4} height={size + 4} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
}
