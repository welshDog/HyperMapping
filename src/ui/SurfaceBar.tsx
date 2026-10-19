import { useState } from 'react';
import { surfaceColor } from '../surfaces/model';
import { canStartLook, MAX_LOOKS } from '../surfaces/sources';
import { FACE_SHAPES, MAX_SURFACES, type FaceShape, type FaceSource, type Surface } from '../surfaces/types';

interface Props {
  surfaces: Surface[];
  selectedId: string;
  onSelect: (id: string) => void;
  selectedShape: FaceShape;
  onAdd: (shape: FaceShape) => void;
  onSetShape: (shape: FaceShape) => void;
  onDelete: () => void;
  onEditSlice: () => void;
  /** What the selected face shows. */
  selectedSource: FaceSource;
  onSetSource: (source: FaceSource) => void;
  /** For a face on a visual look: its own look, or sharing another face's. */
  lookChoice: { mode: 'own' } | { mode: 'shared'; ownerId: string };
  /** The OTHER faces that own a look (the ones the selected face could share). */
  owners: { id: string; label: string }[];
  onOwnLook: () => void;
  onShareLook: (ownerId: string) => void;
}

const SHAPE_LABEL: Record<FaceShape, string> = { quad: 'Quad', triangle: 'Triangle', circle: 'Circle' };
const SOURCE_BUTTONS: { source: FaceSource; label: string }[] = [
  { source: 'video', label: 'Video' },
  { source: 'pattern', label: 'Test pattern' },
  { source: 'look', label: 'Visual look' },
];
const CAP_TITLE = `At most ${MAX_LOOKS} different looks can run at once: switch a face away from its own look first, or share one.`;

/** One tab per face (in that face's colour), plus add (pick a shape), delete, and the selected face's shape and source. */
export function SurfaceBar({
  surfaces,
  selectedId,
  selectedShape,
  onSelect,
  onAdd,
  onSetShape,
  onDelete,
  onEditSlice,
  selectedSource,
  onSetSource,
  lookChoice,
  owners,
  onOwnLook,
  onShareLook,
}: Props) {
  const [adding, setAdding] = useState(false);
  const capFull = !canStartLook(surfaces);
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      {surfaces.map((s, i) => {
        const selected = s.id === selectedId;
        return (
          <button
            key={s.id}
            className={`rounded-lg px-3 py-2 text-xs font-medium ${selected ? 'text-black' : 'bg-zinc-800 text-white'}`}
            style={{ border: `2px solid ${surfaceColor(i)}`, background: selected ? surfaceColor(i) : undefined }}
            onClick={() => onSelect(s.id)}
          >
            Face {i + 1}
          </button>
        );
      })}
      <button
        className="rounded-lg bg-zinc-700 px-3 py-2 text-xs disabled:opacity-40"
        disabled={surfaces.length >= MAX_SURFACES}
        onClick={() => setAdding((a) => !a)}
      >
        + Face
      </button>
      {adding &&
        FACE_SHAPES.map((shape) => (
          <button
            key={`add-${shape}`}
            className="min-h-11 rounded-lg bg-cyan-500 px-4 text-xs font-medium text-black"
            onClick={() => {
              setAdding(false);
              onAdd(shape);
            }}
          >
            + {SHAPE_LABEL[shape]}
          </button>
        ))}
      <button
        className="rounded-lg bg-zinc-700 px-3 py-2 text-xs disabled:opacity-40"
        disabled={surfaces.length <= 1}
        onClick={onDelete}
      >
        Delete
      </button>
      <button className="rounded-lg bg-zinc-700 px-3 py-2 text-xs" onClick={onEditSlice}>
        Edit slice
      </button>
      <div className="flex w-full items-center gap-2">
        <span className="text-xs text-zinc-400">Shape</span>
        {FACE_SHAPES.map((shape) => (
          <button
            key={`shape-${shape}`}
            className={`min-h-11 rounded-lg px-4 text-xs ${shape === selectedShape ? 'bg-cyan-500 font-medium text-black' : 'bg-zinc-800 text-white'}`}
            onClick={() => onSetShape(shape)}
          >
            {SHAPE_LABEL[shape]}
          </button>
        ))}
      </div>
      <div className="flex w-full flex-wrap items-center gap-2">
        <span className="text-xs text-zinc-400">Source</span>
        {SOURCE_BUTTONS.map(({ source, label }) => {
          const blocked = source === 'look' && selectedSource !== 'look' && capFull;
          return (
            <button
              key={`source-${source}`}
              aria-pressed={source === selectedSource}
              disabled={blocked}
              title={blocked ? CAP_TITLE : undefined}
              className={`min-h-11 rounded-lg px-4 text-xs disabled:opacity-40 ${source === selectedSource ? 'bg-cyan-500 font-medium text-black' : 'bg-zinc-800 text-white'}`}
              onClick={() => onSetSource(source)}
            >
              {label}
            </button>
          );
        })}
      </div>
      {selectedSource === 'look' && (
        <div className="flex w-full flex-wrap items-center gap-2">
          <span className="text-xs text-zinc-400">Look</span>
          {(() => {
            const own = lookChoice.mode === 'own';
            const blocked = !own && capFull; // leaving a shared look for an own one needs a free look slot
            return (
              <button
                aria-pressed={own}
                disabled={blocked}
                title={blocked ? CAP_TITLE : undefined}
                className={`min-h-11 rounded-lg px-4 text-xs disabled:opacity-40 ${own ? 'bg-cyan-500 font-medium text-black' : 'bg-zinc-800 text-white'}`}
                onClick={onOwnLook}
              >
                Own look
              </button>
            );
          })()}
          {owners.map((o) => {
            const on = lookChoice.mode === 'shared' && lookChoice.ownerId === o.id;
            return (
              <button
                key={`share-${o.id}`}
                aria-pressed={on}
                className={`min-h-11 rounded-lg px-4 text-xs ${on ? 'bg-cyan-500 font-medium text-black' : 'bg-zinc-800 text-white'}`}
                onClick={() => onShareLook(o.id)}
              >
                Same as {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
