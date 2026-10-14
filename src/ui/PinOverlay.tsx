import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject, type PointerEvent } from 'react';
import { surfaceColor } from '../surfaces/model';
import type { Surface } from '../surfaces/types';
import { clampCorner } from '../warp/quad';
import type { Corners } from '../warp/types';

const IDS = ['tl', 'tr', 'br', 'bl'] as const;
type CornerId = (typeof IDS)[number];

interface Props {
  surfacesRef: MutableRefObject<Surface[]>;
  selectedId: string;
  /** Return true if the quad was accepted. Rejected moves leave the pin where it was. */
  onChange: (surfaceId: string, next: Corners) => boolean;
  /** Bump to repaint after surfacesRef was changed from outside (e.g. "Reset corners"). */
  repaintSignal?: number;
}

/**
 * Every face's outline, with the four pins of the SELECTED face draggable. Other faces are
 * dim outlines with no pointer targets, so a drag can never grab a pin on the wrong face.
 * Positions are painted by mutating SVG attributes directly: a pointermove never causes a render.
 */
export function PinOverlay({ surfacesRef, selectedId, onChange, repaintSignal }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const circles = useRef<Partial<Record<CornerId, SVGCircleElement | null>>>({});
  const outlines = useRef<Record<string, SVGPolygonElement | null>>({});
  const dragging = useRef<CornerId | null>(null);

  const paint = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    for (const s of surfacesRef.current) {
      const c = s.corners;
      outlines.current[s.id]?.setAttribute(
        'points',
        IDS.map((id) => `${c[id][0] * rect.width},${c[id][1] * rect.height}`).join(' '),
      );
      if (s.id !== selectedId) continue;
      for (const id of IDS) {
        const el = circles.current[id];
        if (!el) continue;
        el.setAttribute('cx', String(c[id][0] * rect.width));
        el.setAttribute('cy', String(c[id][1] * rect.height));
      }
    }
  }, [surfacesRef, selectedId]);

  // Repaint after every render: faces can be added/removed/selected between renders.
  useLayoutEffect(() => {
    paint();
  });

  useEffect(() => {
    const observer = new ResizeObserver(paint);
    if (svgRef.current) observer.observe(svgRef.current);
    return () => observer.disconnect();
  }, [paint]);

  useEffect(() => {
    if (repaintSignal !== undefined) paint();
  }, [repaintSignal, paint]);

  // A second finger changing the selection mid-drag must not leave a stale drag behind.
  useEffect(() => {
    dragging.current = null;
  }, [selectedId]);

  const onDown = (id: CornerId) => (e: PointerEvent<SVGCircleElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = id;
  };

  const onMove = (id: CornerId) => (e: PointerEvent<SVGCircleElement>) => {
    if (dragging.current !== id || !svgRef.current) return;
    const selected = surfacesRef.current.find((s) => s.id === selectedId);
    if (!selected) return;
    const rect = svgRef.current.getBoundingClientRect();
    const p = clampCorner([(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height]);
    const next: Corners = { ...selected.corners, [id]: p };
    if (onChange(selectedId, next)) paint();
  };

  const onUp = (e: PointerEvent<SVGCircleElement>) => {
    dragging.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const list = surfacesRef.current;
  const selectedIndex = list.findIndex((s) => s.id === selectedId);
  const selectedColor = surfaceColor(Math.max(0, selectedIndex));

  return (
    // z-30: above the z-20 toolbar so a pin dragged under it can still be grabbed. The SVG
    // itself ignores pointers; only the selected face's circles take them.
    <svg ref={svgRef} className="pointer-events-none absolute inset-0 z-30 h-full w-full">
      {list.map((s, i) =>
        s.id === selectedId ? null : (
          <polygon
            key={s.id}
            ref={(el) => {
              outlines.current[s.id] = el;
            }}
            fill="none"
            strokeWidth={2}
            strokeDasharray="6 4"
            style={{ stroke: surfaceColor(i), opacity: 0.45 }}
          />
        ),
      )}
      {selectedIndex >= 0 && (
        <polygon
          key={selectedId}
          ref={(el) => {
            outlines.current[selectedId] = el;
          }}
          strokeWidth={2.5}
          style={{ stroke: selectedColor, fill: `${selectedColor}22` }}
        />
      )}
      {selectedIndex >= 0 &&
        IDS.map((id) => (
          <circle
            key={id}
            ref={(el) => {
              circles.current[id] = el;
            }}
            r={28}
            className="pointer-events-auto cursor-pointer touch-none fill-white/30"
            strokeWidth={3}
            style={{ stroke: selectedColor }}
            onPointerDown={onDown(id)}
            onPointerMove={onMove(id)}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
        ))}
    </svg>
  );
}
