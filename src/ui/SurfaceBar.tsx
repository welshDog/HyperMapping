import { surfaceColor } from '../surfaces/model';
import { MAX_SURFACES, type Surface } from '../surfaces/types';

interface Props {
  surfaces: Surface[];
  selectedId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDelete: () => void;
  onEditSlice: () => void;
}

/** One tab per face (in that face's colour), plus add and delete. */
export function SurfaceBar({ surfaces, selectedId, onSelect, onAdd, onDelete, onEditSlice }: Props) {
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
        onClick={onAdd}
      >
        + Face
      </button>
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
    </div>
  );
}
