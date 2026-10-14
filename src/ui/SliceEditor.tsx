import { useRef, type PointerEvent } from 'react';
import { moveRect, resizeRect, surfaceColor, type RectCorner } from '../surfaces/model';
import type { SrcRect, Surface } from '../surfaces/types';

interface Props {
  surfaces: Surface[];
  selectedId: string;
  /** Width / height of the loaded video (16/9 until one is loaded). */
  videoAspect: number;
  onChange: (id: string, rect: SrcRect) => void;
  onClose: () => void;
}

const pct = (n: number) => `${n * 100}%`;
const rectStyle = (r: SrcRect) => ({
  left: pct(r.u0),
  top: pct(r.v0),
  width: pct(r.u1 - r.u0),
  height: pct(r.v1 - r.v0),
});

const HANDLES: { corner: RectCorner; style: { left?: string; right?: string; top?: string; bottom?: string } }[] = [
  { corner: 'tl', style: { left: '0%', top: '0%' } },
  { corner: 'tr', style: { left: '100%', top: '0%' } },
  { corner: 'br', style: { left: '100%', top: '100%' } },
  { corner: 'bl', style: { left: '0%', top: '100%' } },
];

/**
 * Pick which part of the video the selected face shows. The big box is the whole video; the
 * selected face's rectangle can be moved (drag the body) or resized (drag a corner).
 * moveRect/resizeRect clamp, so an invalid rectangle can never come out of this component.
 */
export function SliceEditor({ surfaces, selectedId, videoAspect, onChange, onClose }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const move = useRef<{ u: number; v: number; start: SrcRect } | null>(null);
  const resizing = useRef<RectCorner | null>(null);

  const selected = surfaces.find((s) => s.id === selectedId);
  const selectedIndex = surfaces.findIndex((s) => s.id === selectedId);
  const color = surfaceColor(Math.max(0, selectedIndex));

  const toUv = (e: PointerEvent): [number, number] => {
    const r = boxRef.current!.getBoundingClientRect();
    return [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height];
  };

  const onBodyDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!selected) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [u, v] = toUv(e);
    move.current = { u, v, start: selected.srcRect };
  };
  const onBodyMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!move.current || !selected) return;
    const [u, v] = toUv(e);
    onChange(selected.id, moveRect(move.current.start, u - move.current.u, v - move.current.v));
  };
  const onBodyUp = (e: PointerEvent<HTMLDivElement>) => {
    move.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onHandleDown = (corner: RectCorner) => (e: PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    resizing.current = corner;
  };
  const onHandleMove = (corner: RectCorner) => (e: PointerEvent<HTMLDivElement>) => {
    if (resizing.current !== corner || !selected) return;
    const [u, v] = toUv(e);
    onChange(selected.id, resizeRect(selected.srcRect, corner, u, v));
  };
  const onHandleUp = (e: PointerEvent<HTMLDivElement>) => {
    resizing.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/90 p-4">
      <p className="text-xs text-zinc-300">
        Face {Math.max(0, selectedIndex) + 1}: drag the box to move its slice of the video, drag a corner to resize.
      </p>
      <div
        ref={boxRef}
        className="relative touch-none overflow-hidden rounded-md border border-zinc-600 bg-zinc-900"
        style={{ aspectRatio: String(videoAspect), width: `min(92vw, calc(60vh * ${videoAspect}))` }}
      >
        {surfaces.map((s, i) =>
          s.id === selectedId ? null : (
            <div
              key={s.id}
              className="pointer-events-none absolute"
              style={{ ...rectStyle(s.srcRect), border: `2px dashed ${surfaceColor(i)}`, opacity: 0.5 }}
            />
          ),
        )}
        {selected && (
          <div
            className="absolute cursor-move"
            style={{ ...rectStyle(selected.srcRect), border: `3px solid ${color}`, background: `${color}33` }}
            onPointerDown={onBodyDown}
            onPointerMove={onBodyMove}
            onPointerUp={onBodyUp}
            onPointerCancel={onBodyUp}
          >
            {HANDLES.map((h) => (
              <div
                key={h.corner}
                className="absolute h-8 w-8 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border-2 bg-white/40"
                style={{ ...h.style, borderColor: color }}
                onPointerDown={onHandleDown(h.corner)}
                onPointerMove={onHandleMove(h.corner)}
                onPointerUp={onHandleUp}
                onPointerCancel={onHandleUp}
              />
            ))}
          </div>
        )}
      </div>
      <button className="rounded-lg bg-cyan-500 px-6 py-3 font-medium text-black" onClick={onClose}>
        Done
      </button>
    </div>
  );
}
