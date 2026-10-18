import { useState } from 'react';
import { surfaceColor } from '../surfaces/model';
import { FACE_SHAPES, MAX_SURFACES, type FaceShape, type Surface } from '../surfaces/types';

interface Props {
  surfaces: Surface[];
  selectedId: string;
  onSelect: (id: string) => void;
  selectedShape: FaceShape;
  onAdd: (shape: FaceShape) => void;
  onSetShape: (shape: FaceShape) => void;
  onDelete: () => void;
  onEditSlice: () => void;
}

const SHAPE_LABEL: Record<FaceShape, string> = { quad: 'Quad', triangle: 'Triangle', circle: 'Circle' };

/** One tab per face (in that face's colour), plus add (pick a shape), delete, and the selected face's shape. */
export function SurfaceBar({ surfaces, selectedId, selectedShape, onSelect, onAdd, onSetShape, onDelete, onEditSlice }: Props) {
  const [adding, setAdding] = useState(false);
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
    </div>
  );
}
