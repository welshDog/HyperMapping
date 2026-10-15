import { useRef, useState } from 'react';
import { LOOK_STYLES, lookToCode, type StylePick } from '../generator/look';
import { SPEED_MAX, SPEED_MIN, setSpeed } from '../generator/speed';
import { SHUFFLE_CHOICES, type GeneratorState } from '../generator/shuffle';
import type { AudioSettings } from '../audio/settings';
import type { AudioStatus, MeterLevels } from './useAudioReactor';
import { applyCode, pickStyle, randomizeOn, setOn, setShuffle } from './generator-actions';

/** What the Sound section needs from useAudioReactor. */
export interface SoundProps {
  status: AudioStatus;
  levels: MeterLevels;
  settings: AudioSettings;
  setSettings: (next: AudioSettings) => void;
  start: () => Promise<void>;
  stop: () => void;
  /** False when this browser has no microphone listening at all (createAudioListener() === null). */
  supported: boolean;
}

const STATUS_TEXT: Record<AudioStatus, string> = {
  off: 'Off',
  listening: 'Listening',
  denied: "Microphone blocked: allow it in the browser's site settings",
  'no-mic': 'No microphone found',
  starting: 'Starting… allow the microphone if asked',
  unsupported: 'Could not start the microphone (it may be in use by another app, or not supported here)',
};

const REACTIONS: { key: 'bass' | 'treble' | 'volume' | 'beatLook'; label: string }[] = [
  { key: 'bass', label: 'Bass punch' },
  { key: 'treble', label: 'Treble sparkle' },
  { key: 'volume', label: 'Volume speeds motion' },
  { key: 'beatLook', label: 'Big beat starts a new look' },
];

const METERS: { key: keyof MeterLevels; label: string }[] = [
  { key: 'bass', label: 'Bass' },
  { key: 'treble', label: 'Treble' },
  { key: 'volume', label: 'Volume' },
];

interface Props {
  state: GeneratorState;
  /** False when this browser cannot make the generator. */
  available: boolean;
  /** The Editor's Test pattern button: while on, it hides the visuals. */
  patternForce: boolean;
  onChange: (next: GeneratorState) => void;
  audio: SoundProps;
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
export function GeneratorPanel({ state, available, patternForce, onChange, audio, onClose }: Props) {
  const [codeText, setCodeText] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const codeBoxRef = useRef<HTMLInputElement>(null);
  const code = lookToCode(state.look);

  /** One bg-* class per state: pressed, normal and disabled replace each other. */
  const cls = (pressed: boolean) => `${BASE} ${!available ? DISABLED : pressed ? ON : OFF}`;

  const listening = audio.status === 'listening';
  const starting = audio.status === 'starting';
  const soundOk = audio.supported;
  /** One bg-* class per state: unsupported, listening (Stop) and idle (Listen) replace each other. */
  const listenCls = `${BASE} min-w-[7.5rem] ${!soundOk || starting ? DISABLED : listening ? ON : OFF}`;
  const pct = (x: number) => Math.round(Math.min(1, Math.max(0, x)) * 100);

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
          <label htmlFor="visuals-speed" className="flex justify-between text-xs text-zinc-400">
            <span>Speed</span>
            <span>{state.speed.toFixed(2)}x</span>
          </label>
          <input
            id="visuals-speed"
            type="range"
            aria-label="Speed"
            min={SPEED_MIN}
            max={SPEED_MAX}
            step={0.05}
            value={state.speed}
            disabled={!available}
            className="w-full accent-cyan-500 disabled:opacity-40"
            onChange={(e) => {
              const v = e.currentTarget.valueAsNumber;
              if (Number.isFinite(v)) onChange(setSpeed(state, v, Date.now()));
            }}
          />
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

        <div className="mt-2 flex flex-col gap-3 border-t border-zinc-700 pt-3">
          <h3 className="text-sm font-semibold">Sound</h3>
          {!soundOk && <p className="text-xs text-amber-400">Not supported in this browser</p>}
          <div className="flex items-center gap-3">
            <button
              aria-pressed={listening}
              disabled={!soundOk || starting}
              className={listenCls}
              onClick={() => (listening ? audio.stop() : void audio.start())}
            >
              {listening ? 'Stop' : starting ? 'Starting…' : 'Listen'}
            </button>
            <span role="status" className="text-xs text-zinc-400">
              {soundOk ? STATUS_TEXT[audio.status] : ''}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            {METERS.map(({ key, label }) => (
              <div key={key} className="flex items-center gap-2 text-xs text-zinc-400">
                <span className="w-14">{label}</span>
                <div
                  role="meter"
                  aria-label={label}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={pct(audio.levels[key])}
                  className="h-2 flex-1 overflow-hidden rounded bg-zinc-800"
                >
                  <div className="h-full bg-cyan-500" style={{ width: `${pct(audio.levels[key])}%` }} />
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="sound-sensitivity" className="flex justify-between text-xs text-zinc-400">
              <span>Sensitivity</span>
              <span>{audio.settings.sensitivity.toFixed(1)}</span>
            </label>
            <input
              id="sound-sensitivity"
              type="range"
              min={0.2}
              max={3}
              step={0.1}
              value={audio.settings.sensitivity}
              disabled={!soundOk}
              className="w-full accent-cyan-500 disabled:opacity-40"
              onChange={(e) => {
                const v = e.currentTarget.valueAsNumber;
                if (Number.isFinite(v)) audio.setSettings({ ...audio.settings, sensitivity: v });
              }}
            />
          </div>

          <div className="flex flex-col gap-2">
            {REACTIONS.map(({ key, label }) => (
              <label key={key} className={`flex items-center gap-2 text-sm ${soundOk ? '' : 'opacity-40'}`}>
                <input
                  type="checkbox"
                  checked={audio.settings[key]}
                  disabled={!soundOk}
                  className="h-5 w-5 accent-cyan-500"
                  onChange={(e) => audio.setSettings({ ...audio.settings, [key]: e.currentTarget.checked })}
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <button className="mt-2 self-center rounded-lg bg-cyan-500 px-6 py-3 font-medium text-black" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
