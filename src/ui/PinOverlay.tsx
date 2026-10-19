import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject, type PointerEvent } from 'react';
import { CORNER_KEYS, gluedGroup, type CornerKey, type PinRef } from '../surfaces/glue';
import { surfaceColor } from '../surfaces/model';
import { shapeOutlinePoints } from '../surfaces/outline';
import { shapeOf, type Surface } from '../surfaces/types';
import { clampCorner } from '../warp/quad';
import type { Vec2 } from '../warp/types';
import { createPointerGate } from './pointer-gate';

interface Props {
  surfacesRef: MutableRefObject<Surface[]>;
  selectedId: string;
  /**
   * A pin of the selected face was dragged to `p` (clamped, unit space). `size` is the overlay's
   * pixel size, needed to measure snapping in pixels. Return true if the move was accepted.
   */
  onPinMove: (ref: PinRef, p: Vec2, size: { w: number; h: number }) => boolean;
  /** A pin or grab drag began / ended (also on cancel, or when the selection changes mid-drag). */
  onPinDragStart?: () => void;
  onPinDragEnd?: () => void;
  /**
   * The body of a face was grabbed and dragged: `delta` (unit space) is how far the pointer has moved since
   * the grab began. Return true if the move was accepted. Pressing a face's body also selects it.
   */
  onGrabMove?: (faceId: string, delta: Vec2) => boolean;
  onSelectFace?: (faceId: string) => void;
  /** Bump to repaint after surfacesRef was changed from outside (e.g. "Reset corners"). */
  repaintSignal?: number;
}

/**
 * Every face's outline. The four pins of the SELECTED face are draggable; the corners of the other
 * faces are small dim dots (so you can see where a pin will snap) and a ring marks a pin that is
 * glued to another. Positions are painted by mutating SVG attributes directly: a pointermove never
 * causes a React render.
 */
export function PinOverlay({ surfacesRef, selectedId, onPinMove, onPinDragStart, onPinDragEnd, onGrabMove, onSelectFace, repaintSignal }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const hitEls = useRef<Record<string, SVGPolygonElement | null>>({});
  // The face body being grabbed: where the pointer started (unit space). One finger at a time via `gate`.
  const grab = useRef<{ faceId: string; startX: number; startY: number } | null>(null);
  const circles = useRef<Partial<Record<CornerKey, SVGCircleElement | null>>>({});
  const rings = useRef<Partial<Record<CornerKey, SVGCircleElement | null>>>({});
  const dots = useRef<Record<string, SVGCircleElement | null>>({});
  const outlines = useRef<Record<string, SVGPolygonElement | null>>({});
  const shapeEls = useRef<Record<string, SVGPolygonElement | null>>({});
  const dragging = useRef<CornerKey | null>(null);
  // One drag at a time: the first finger down owns it; a second finger is ignored until it lifts.
  const gate = useRef(createPointerGate());

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
      hitEls.current[s.id]?.setAttribute(
        'points',
        shapeOutlinePoints(shapeOf(s), c)
          .map(([px, py]) => `${px * rect.width},${py * rect.height}`)
          .join(' '),
      );
      const shapeEl = shapeEls.current[s.id];
      if (shapeEl) {
        shapeEl.setAttribute(
          'points',
          shapeOutlinePoints(shapeOf(s), c)
            .map(([px, py]) => `${px * rect.width},${py * rect.height}`)
            .join(' '),
        );
      }
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
    // Grabbing a face body selects it: that selection change must not cancel the grab that caused it.
    if (grab.current?.faceId === selectedId) return;
    gate.current.reset();
    if (dragging.current !== null) {
      dragging.current = null;
      onPinDragEnd?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only a selection change should end a drag
  }, [selectedId]);

  const onDown = (corner: CornerKey) => (e: PointerEvent<SVGCircleElement>) => {
    e.stopPropagation();
    // A second finger while another is dragging does nothing (and never steals or ends the first drag).
    if (!gate.current.down(e.pointerId)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = corner;
    onPinDragStart?.();
  };

  const onMove = (corner: CornerKey) => (e: PointerEvent<SVGCircleElement>) => {
    if (!gate.current.owns(e.pointerId) || dragging.current !== corner || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const p = clampCorner([(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height]);
    if (onPinMove({ surfaceId: selectedId, corner }, p, { w: rect.width, h: rect.height })) paint();
  };

  const onUp = (e: PointerEvent<SVGCircleElement>) => {
    // Only the finger that owns the drag can end it; any other finger lifting is ignored.
    if (!gate.current.up(e.pointerId)) return;
    dragging.current = null;
    onPinDragEnd?.();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const toUnit = (e: PointerEvent): Vec2 | null => {
    const el = svgRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return null;
    return [(e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height];
  };

  const onGrabDown = (faceId: string) => (e: PointerEvent<SVGPolygonElement>) => {
    const at = toUnit(e);
    if (!at) return;
    e.stopPropagation();
    if (!gate.current.down(e.pointerId)) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    grab.current = { faceId, startX: at[0], startY: at[1] };
    onPinDragStart?.(); // the drag base is the layout as it is right now
    if (faceId !== selectedId) onSelectFace?.(faceId);
  };

  const onGrabMoveEvent = (faceId: string) => (e: PointerEvent<SVGPolygonElement>) => {
    const g = grab.current;
    if (!g || g.faceId !== faceId || !gate.current.owns(e.pointerId)) return;
    const at = toUnit(e);
    if (!at) return;
    if (onGrabMove?.(faceId, [at[0] - g.startX, at[1] - g.startY])) paint();
  };

  const onGrabUp = (e: PointerEvent<SVGPolygonElement>) => {
    if (!gate.current.up(e.pointerId)) return;
    grab.current = null;
    onPinDragEnd?.();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const list = surfacesRef.current;
  const selectedIndex = list.findIndex((s) => s.id === selectedId);
  const selectedColor = surfaceColor(Math.max(0, selectedIndex));

  return (
    <>
      {/* The grab layer sits BELOW the z-20 toolbar (a shape under a button must not swallow the press) and
          below the pins; only the real shape outline takes pointers, in draw order (last face on top). */}
      <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full">
        {list.map((s) => (
          <polygon
            key={`hit-${s.id}`}
            ref={(el) => {
              hitEls.current[s.id] = el;
            }}
            fill="transparent"
            className="cursor-move touch-none"
            style={{ pointerEvents: 'fill' }}
            onPointerDown={onGrabDown(s.id)}
            onPointerMove={onGrabMoveEvent(s.id)}
            onPointerUp={onGrabUp}
            onPointerCancel={onGrabUp}
          />
        ))}
      </svg>
    {/* z-30: above the z-20 toolbar so a pin dragged under it can still be grabbed. The SVG
        itself ignores pointers; only the selected face's circles take them. */}
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
            style={{ stroke: surfaceColor(i), opacity: shapeOf(s) === 'quad' ? 0.45 : 0.25 }}
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
          strokeDasharray={shapeOf(list[selectedIndex]) === 'quad' ? undefined : '6 4'}
          style={{
            stroke: selectedColor,
            fill: shapeOf(list[selectedIndex]) === 'quad' ? `${selectedColor}22` : 'none',
            opacity: shapeOf(list[selectedIndex]) === 'quad' ? 1 : 0.6,
          }}
        />
      )}
      {/* The cut-out shape itself (triangle, circle), drawn inside the dashed frame. */}
      {list.map((s, i) =>
        shapeOf(s) === 'quad' ? null : (
          <polygon
            key={`shape-${s.id}`}
            ref={(el) => {
              shapeEls.current[s.id] = el;
            }}
            strokeWidth={s.id === selectedId ? 3 : 2}
            style={{
              stroke: surfaceColor(i),
              fill: s.id === selectedId ? `${surfaceColor(i)}22` : 'none',
              opacity: s.id === selectedId ? 1 : 0.6,
            }}
          />
        ),
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
    </>
  );
}
