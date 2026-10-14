import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject, type PointerEvent } from 'react';
import { CORNER_KEYS, gluedGroup, type CornerKey, type PinRef } from '../surfaces/glue';
import { surfaceColor } from '../surfaces/model';
import type { Surface } from '../surfaces/types';
import { clampCorner } from '../warp/quad';
import type { Vec2 } from '../warp/types';

interface Props {
  surfacesRef: MutableRefObject<Surface[]>;
  selectedId: string;
  /**
   * A pin of the selected face was dragged to `p` (clamped, unit space). `size` is the overlay's
   * pixel size, needed to measure snapping in pixels. Return true if the move was accepted.
   */
  onPinMove: (ref: PinRef, p: Vec2, size: { w: number; h: number }) => boolean;
  /** Bump to repaint after surfacesRef was changed from outside (e.g. "Reset corners"). */
  repaintSignal?: number;
}

/**
 * Every face's outline. The four pins of the SELECTED face are draggable; the corners of the other
 * faces are small dim dots (so you can see where a pin will snap) and a ring marks a pin that is
 * glued to another. Positions are painted by mutating SVG attributes directly: a pointermove never
 * causes a React render.
 */
export function PinOverlay({ surfacesRef, selectedId, onPinMove, repaintSignal }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const circles = useRef<Partial<Record<CornerKey, SVGCircleElement | null>>>({});
  const rings = useRef<Partial<Record<CornerKey, SVGCircleElement | null>>>({});
  const dots = useRef<Record<string, SVGCircleElement | null>>({});
  const outlines = useRef<Record<string, SVGPolygonElement | null>>({});
  const dragging = useRef<CornerKey | null>(null);

  const paint = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const list = surfacesRef.current;
    for (const s of list) {
      const c = s.corners;
      outlines.current[s.id]?.setAttribute(
        'points',
        CORNER_KEYS.map((k) => `${c[k][0] * rect.width},${c[k][1] * rect.height}`).join(' '),
      );
      for (const k of CORNER_KEYS) {
        const x = String(c[k][0] * rect.width);
        const y = String(c[k][1] * rect.height);
        if (s.id === selectedId) {
          const pinEl = circles.current[k];
          pinEl?.setAttribute('cx', x);
          pinEl?.setAttribute('cy', y);
          const ring = rings.current[k];
          if (ring) {
            ring.setAttribute('cx', x);
            ring.setAttribute('cy', y);
            ring.setAttribute('opacity', gluedGroup(list, { surfaceId: s.id, corner: k }).length > 1 ? '1' : '0');
          }
        } else {
          const dot = dots.current[`${s.id}:${k}`];
          dot?.setAttribute('cx', x);
          dot?.setAttribute('cy', y);
        }
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

  const onDown = (corner: CornerKey) => (e: PointerEvent<SVGCircleElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = corner;
  };

  const onMove = (corner: CornerKey) => (e: PointerEvent<SVGCircleElement>) => {
    if (dragging.current !== corner || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const p = clampCorner([(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height]);
    if (onPinMove({ surfaceId: selectedId, corner }, p, { w: rect.width, h: rect.height })) paint();
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
      {list.flatMap((s, i) =>
        s.id === selectedId
          ? []
          : CORNER_KEYS.map((k) => (
              <circle
                key={`${s.id}:${k}`}
                ref={(el) => {
                  dots.current[`${s.id}:${k}`] = el;
                }}
                r={5}
                style={{ fill: surfaceColor(i), opacity: 0.85 }}
              />
            )),
      )}
      {selectedIndex >= 0 &&
        CORNER_KEYS.map((k) => (
          <circle
            key={`ring-${k}`}
            ref={(el) => {
              rings.current[k] = el;
            }}
            r={38}
            fill="none"
            stroke="white"
            strokeWidth={2}
            strokeDasharray="4 3"
            opacity={0}
          />
        ))}
      {selectedIndex >= 0 &&
        CORNER_KEYS.map((k) => (
          <circle
            key={k}
            ref={(el) => {
              circles.current[k] = el;
            }}
            r={28}
            className="pointer-events-auto cursor-pointer touch-none fill-white/30"
            strokeWidth={3}
            style={{ stroke: selectedColor }}
            onPointerDown={onDown(k)}
            onPointerMove={onMove(k)}
            onPointerUp={onUp}
            onPointerCancel={onUp}
          />
        ))}
    </svg>
  );
}
