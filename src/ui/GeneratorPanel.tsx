import { useRef, useState } from 'react';
import { LOOK_STYLES, lookToCode, type StylePick } from '../generator/look';
import { SHUFFLE_CHOICES, type GeneratorState } from '../generator/shuffle';
import { applyCode, pickStyle, randomizeOn, setOn, setShuffle } from './generator-actions';

interface Props {
  state: GeneratorState;
  /** False when this browser cannot make the generator. */
  available: boolean;
  /** The Editor's Test pattern button: while on, it hides the visuals. */
  patternForce: boolean;
  onChange: (next: GeneratorState) => void;
  onClose: () => void;
}

const STYLE_LABEL: Record<string, string> = {
  auto: 'Auto',
  plasma: 'Plasma',
  kaleidoscope: 'Kaleidoscope',
  neon: 'Neon',
  particles: 'Particles',
};
const PICKS: StylePick[] = ['auto', ...LOOK_STYLES];
const BAD_CODE = 'That code is not valid. Codes look like K-7F3A92C1B.';

const BASE = 'rounded-lg px-3 py-3 text-sm font-medium';
const OFF = 'bg-zinc-700 text-white';
const ON = 'bg-cyan-500 text-black';
const DISABLED = 'bg-zinc-800 text-zinc-500 cursor-not-allowed';

interface Status {
  text: string;
  error: boolean;
}

/** The Visuals panel: switch the random-visuals generator on, pick a look, shuffle, copy or enter a code. */
export function GeneratorPanel({ state, available, patternForce, onChange, onClose }: Props) {
  const [codeText, setCodeText] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const codeBoxRef = useRef<HTMLInputElement>(null);
  const code = lookToCode(state.look);

  /** One bg-* class per state: pressed, normal and disabled replace each other. */
  const cls = (pressed: boolean) => `${BASE} ${!available ? DISABLED : pressed ? ON : OFF}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setStatus({ text: 'Copied.', error: false });
    } catch {
      try {
        codeBoxRef.current?.focus();
        codeBoxRef.current?.select();
      } catch {
        // nothing more to try
      }
      setStatus({ text: 'Copy is not available here: the code is selected, copy it by hand.', error: true });
    }
  };

  const applyTypedCode = () => {
    const result = applyCode(state, codeText, Date.now());
    if (!result.ok) {
      setStatus({ text: BAD_CODE, error: true });
      return;
    }
    onChange(result.state);
    setCodeText('');
    setStatus({ text: 'Look applied.', error: false });
  };

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center overflow-auto bg-black/90 p-6">
      <div className="m-auto flex w-full max-w-md flex-col gap-3">
        <h2 className="text-base font-semibold">Visuals</h2>
        {available ? (
          <p className="text-xs text-zinc-400">
            Random moving visuals for your faces. A loaded video is replaced while this is on; the test pattern still wins.
          </p>
        ) : (
          <p className="text-xs text-amber-400">Visuals are not supported in this browser</p>
        )}

        {available && state.on && patternForce && (
          <p className="text-xs text-amber-400">
            The test pattern is on, so the visuals are hidden. Turn Test pattern off to see them.
          </p>
        )}

        <div className="flex items-center gap-2">
          <button
            aria-pressed={state.on}
            disabled={!available}
            className={`${cls(state.on)} min-w-[7.5rem]`}
            onClick={() => onChange(setOn(state, !state.on, Date.now()))}
          >
            Visuals: {state.on ? 'on' : 'off'}
          </button>
          <button
            disabled={!available}
            className={cls(false)}
            onClick={() => onChange(randomizeOn(state, Date.now(), Math.random))}
          >
            Randomize
          </button>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-zinc-400">
            Look: Auto mixes all four; pick one to lock to that style (the picture changes straight away). Showing:{' '}
            {STYLE_LABEL[state.look.style]}
          </span>
          <div className="flex flex-wrap gap-2">
            {PICKS.map((p) => (
              <button
                key={p}
                aria-pressed={state.stylePick === p}
                disabled={!available}
                className={cls(state.stylePick === p)}
                onClick={() => onChange(pickStyle(state, p, Date.now(), Math.random))}
              >
                {STYLE_LABEL[p]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-zinc-400">Auto-shuffle</span>
          <div className="flex flex-wrap gap-2">
            {SHUFFLE_CHOICES.map((s) => (
              <button
                key={s}
                aria-pressed={state.shuffleSec === s}
                disabled={!available}
                className={cls(state.shuffleSec === s)}
                onClick={() => onChange(setShuffle(state, s, Date.now()))}
              >
                {s === 0 ? 'Off' : `${s} s`}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-zinc-400">This look&apos;s code</span>
          <div className="flex gap-2">
            <input
              ref={codeBoxRef}
              readOnly
              aria-label="Current look code"
              value={code}
              className="min-w-0 flex-1 select-text rounded-lg bg-zinc-800 px-3 py-2 text-base text-white"
              onFocus={(e) => e.currentTarget.select()}
            />
            <button className={`${BASE} ${OFF}`} onClick={copy}>
              Copy
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-zinc-400">Use a code</span>
          <div className="flex gap-2">
            <input
              aria-label="Look code to use"
              className="min-w-0 flex-1 select-text rounded-lg bg-zinc-800 px-3 py-2 text-base text-white disabled:opacity-40"
              placeholder="K-7F3A92C1B"
              maxLength={16}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              disabled={!available}
              value={codeText}
              onChange={(e) => {
                setCodeText(e.target.value.trim().toUpperCase());
                setStatus(null);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyTypedCode();
              }}
            />
            <button disabled={!available} className={cls(false)} onClick={applyTypedCode}>
              Use code
            </button>
          </div>
        </div>

        {status && <p className={`text-xs ${status.error ? 'text-amber-400' : 'text-emerald-400'}`}>{status.text}</p>}

        <button className="mt-2 self-center rounded-lg bg-cyan-500 px-6 py-3 font-medium text-black" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
