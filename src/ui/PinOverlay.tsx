import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject, type PointerEvent } from 'react';
import { clampCorner } from '../warp/quad';
import type { Corners } from '../warp/types';

const IDS = ['tl', 'tr', 'br', 'bl'] as const;
type CornerId = (typeof IDS)[number];

interface Props {
  cornersRef: MutableRefObject<Corners>;
  /** Return true if the quad was accepted. Rejected moves leave the pin where it was. */
  onChange: (next: Corners) => boolean;
  /** Bump to repaint the pins after cornersRef was changed from outside (e.g. "Reset corners"). */
  resetSignal?: number;
}

/**
 * Four draggable pins over the canvas. Positions are painted by mutating the
 * SVG attributes directly: a pointermove never causes a React render.
 */
export function PinOverlay({ cornersRef, onChange, resetSignal }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const circles = useRef<Partial<Record<CornerId, SVGCircleElement | null>>>({});
  const outline = useRef<SVGPolygonElement>(null);
  const dragging = useRef<CornerId | null>(null);

  const paint = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const c = cornersRef.current;
    for (const id of IDS) {
      const el = circles.current[id];
      if (!el) continue;
      el.setAttribute('cx', String(c[id][0] * rect.width));
      el.setAttribute('cy', String(c[id][1] * rect.height));
    }
    outline.current?.setAttribute(
      'points',
      IDS.map((id) => `${c[id][0] * rect.width},${c[id][1] * rect.height}`).join(' '),
    );
  }, [cornersRef]);

  useLayoutEffect(() => {
    paint();
    const observer = new ResizeObserver(paint);
    if (svgRef.current) observer.observe(svgRef.current);
    return () => observer.disconnect();
  }, [paint]);

  useEffect(() => {
    if (resetSignal !== undefined) paint();
  }, [resetSignal, paint]);

  const onDown = (id: CornerId) => (e: PointerEvent<SVGCircleElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = id;
  };

  const onMove = (id: CornerId) => (e: PointerEvent<SVGCircleElement>) => {
    if (dragging.current !== id || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const p = clampCorner([(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height]);
    const next: Corners = { ...cornersRef.current, [id]: p };
    if (onChange(next)) paint();
  };

  const onUp = (e: PointerEvent<SVGCircleElement>) => {
    dragging.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    // z-30: above the z-20 toolbar so a pin dragged under it can still be grabbed. The SVG
    // itself ignores pointers; only the circles take them, so the toolbar works around them.
    <svg ref={svgRef} className="pointer-events-none absolute inset-0 z-30 h-full w-full">
      <polygon ref={outline} className="fill-cyan-400/10 stroke-cyan-400" strokeWidth={2} />
      {IDS.map((id) => (
        <circle
          key={id}
          ref={(el) => {
            circles.current[id] = el;
          }}
          r={28}
          className="pointer-events-auto cursor-pointer touch-none fill-white/30 stroke-cyan-400"
          strokeWidth={3}
          onPointerDown={onDown(id)}
          onPointerMove={onMove(id)}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        />
      ))}
    </svg>
  );
}
