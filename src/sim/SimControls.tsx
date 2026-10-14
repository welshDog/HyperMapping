import type { Box } from './box';
import { ASPECT_PRESETS } from './defaults';
import type { Projector } from './solve';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}

function Slider({ label, value, min, max, step, unit = '', onChange }: SliderProps) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-24 shrink-0 text-zinc-300">{label}</span>
      <input
        type="range"
        className="flex-1"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
      <span className="w-16 text-right tabular-nums text-zinc-400">
        {value.toFixed(2)}
        {unit}
      </span>
    </label>
  );
}

interface Props {
  box: Box;
  projector: Projector;
  onBox: (b: Box) => void;
  onProjector: (p: Projector) => void;
}

export function SimControls({ box, projector, onBox, onProjector }: Props) {
  const setB = (patch: Partial<Box>) => onBox({ ...box, ...patch });
  const setP = (patch: Partial<Projector>) => onProjector({ ...projector, ...patch });
  const presetIndex = ASPECT_PRESETS.findIndex((a) => Math.abs(a.value - projector.aspect) < 1e-6);
  return (
    <div className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-white">Box (metres)</h2>
      <Slider label="Width" value={box.width} min={0.2} max={3} step={0.05} onChange={(v) => setB({ width: v })} />
      <Slider label="Height" value={box.height} min={0.2} max={3} step={0.05} onChange={(v) => setB({ height: v })} />
      <Slider label="Depth" value={box.depth} min={0.2} max={3} step={0.05} onChange={(v) => setB({ depth: v })} />
      <Slider label="Turn" value={box.yawDeg} min={-180} max={180} step={1} unit="°" onChange={(v) => setB({ yawDeg: v })} />
      <h2 className="mt-2 text-sm font-semibold text-white">Projector</h2>
      <Slider label="Distance" value={projector.distance} min={0.5} max={10} step={0.05} onChange={(v) => setP({ distance: v })} />
      <Slider label="Side angle" value={projector.azimuthDeg} min={-180} max={180} step={1} unit="°" onChange={(v) => setP({ azimuthDeg: v })} />
      <Slider label="Lens height" value={projector.height} min={0} max={4} step={0.05} onChange={(v) => setP({ height: v })} />
      <Slider label="Throw ratio" value={projector.throwRatio} min={0.4} max={3} step={0.05} onChange={(v) => setP({ throwRatio: v })} />
      <label className="flex items-center gap-2 text-xs">
        <span className="w-24 shrink-0 text-zinc-300">Image shape</span>
        <select
          className="flex-1 rounded bg-zinc-800 px-2 py-1 text-zinc-100"
          value={presetIndex >= 0 ? presetIndex : 0}
          onChange={(e) => {
            const preset = ASPECT_PRESETS[Number(e.target.value)];
            if (preset) setP({ aspect: preset.value });
          }}
        >
          {ASPECT_PRESETS.map((a, i) => (
            <option key={a.label} value={i}>
              {a.label}
            </option>
          ))}
        </select>
      </label>
      <Slider label="Lens shift" value={projector.shiftY} min={-0.5} max={0.5} step={0.01} onChange={(v) => setP({ shiftY: v })} />
    </div>
  );
}
