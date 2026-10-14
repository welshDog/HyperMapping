import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { downloadText } from '../setups/download';
import {
  FILE_MAX_CHARS,
  MAX_SETUPS,
  deleteSetup,
  fileNameFor,
  listSetups,
  normalizeName,
  parseSetupFile,
  saveSetup,
  setupToFile,
  type KeyValueStore,
  type Setup,
} from '../setups/setups';
import type { Surface } from '../surfaces/types';

interface Props {
  /** Browser storage, or null when it is blocked (private window). */
  store: KeyValueStore | null;
  getSurfaces: () => Surface[];
  hasVideo: boolean;
  onLoad: (list: Surface[]) => void;
  onStartFresh: () => void;
  onClose: () => void;
}

const SAVE_ERRORS = {
  'bad-name': 'Give the setup a name (1 to 40 characters).',
  'bad-surfaces': 'The current layout cannot be saved.',
  full: `You already have ${MAX_SETUPS} setups: delete one first.`,
  storage: "Saving isn't available in this browser mode: use Export instead.",
} as const;

const NOT_A_SETUP = "That isn't a HyperMapping setup.";
const CONFIRM_MS = 3000;

/** Save, load, delete, export and import face layouts. A modal panel over the Editor. */
export function SetupsPanel({ store, getSurfaces, hasVideo, onLoad, onStartFresh, onClose }: Props) {
  const [setups, setSetups] = useState<Setup[]>(() => (store ? listSetups(store) : []));
  const [name, setName] = useState('');
  const [status, setStatus] = useState<string | null>(
    store ? null : "Saving to this browser isn't available here: use Export and Import instead.",
  );
  const [confirming, setConfirming] = useState<string | null>(null);
  const confirmTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    },
    [],
  );

  /** Two taps for anything destructive: the first arms the button, the second does it. */
  const twoStep = (key: string, action: () => void) => {
    if (confirming === key) {
      if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
      confirmTimer.current = null;
      setConfirming(null);
      action();
      return;
    }
    setConfirming(key);
    if (confirmTimer.current !== null) window.clearTimeout(confirmTimer.current);
    confirmTimer.current = window.setTimeout(() => {
      confirmTimer.current = null;
      setConfirming(null);
    }, CONFIRM_MS);
  };

  const save = () => {
    if (!store) return;
    const result = saveSetup(store, name, getSurfaces(), Date.now());
    if (!result.ok) {
      setStatus(SAVE_ERRORS[result.reason]);
      return;
    }
    setSetups(result.setups);
    setStatus(`${result.replaced ? 'Replaced' : 'Saved'} "${normalizeName(name)}".`);
  };

  const load = (setup: Setup) => {
    onLoad(setup.surfaces);
    setName(setup.name);
    setStatus(`Loaded "${setup.name}".${hasVideo ? '' : ' Load your video to see it on the faces.'}`);
  };

  const remove = (setupName: string) => {
    if (!store) return;
    setSetups(deleteSetup(store, setupName));
    setStatus(`Deleted "${setupName}".`);
  };

  const exportFile = () => {
    const label = normalizeName(name) ?? 'layout';
    const file = fileNameFor(label);
    try {
      downloadText(file, setupToFile({ name: label, savedAt: Date.now(), surfaces: getSurfaces() }));
      setStatus(`Exported ${file}.`);
    } catch {
      setStatus('Could not export the file.');
    }
  };

  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > FILE_MAX_CHARS * 4) {
      setStatus(NOT_A_SETUP); // far bigger than any real setup: do not even read it
      return;
    }
    try {
      const setup = parseSetupFile(await file.text());
      if (!setup) {
        setStatus(NOT_A_SETUP);
        return;
      }
      onLoad(setup.surfaces);
      setName(setup.name);
      setStatus(`Imported "${setup.name}".${store ? ' Press Save to keep it in this browser.' : ''}`);
    } catch {
      setStatus('Could not read that file.');
    }
  };

  const btn = 'rounded-lg bg-zinc-700 px-3 py-2 text-sm disabled:opacity-40';

  return (
    <div className="absolute inset-0 z-40 flex flex-col items-center overflow-auto bg-black/90 p-6">
      <div className="m-auto flex w-full max-w-md flex-col gap-3">
        <h2 className="text-base font-semibold">Setups</h2>
        <p className="text-xs text-zinc-400">
          A setup is the layout of your faces (pins and slices). The video is not saved: load it again after loading a setup.
          Saved setups live in this browser only: use Export for a backup file.
        </p>

        <div className="flex gap-2">
          <input
            className="min-w-0 flex-1 rounded-lg bg-zinc-800 px-3 py-2 text-sm text-white"
            placeholder="Setup name"
            maxLength={40}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className={`${btn} bg-cyan-500 text-black`} disabled={!store} onClick={save}>
            Save
          </button>
        </div>

        {status && <p className="text-xs text-emerald-400">{status}</p>}

        <ul className="flex flex-col gap-2">
          {setups.length === 0 && <li className="text-xs text-zinc-500">{store ? 'No saved setups yet.' : ''}</li>}
          {setups.map((s) => (
            <li key={s.name} className="flex items-center gap-2 rounded-lg bg-zinc-900 p-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">{s.name}</div>
                <div className="text-xs text-zinc-500">
                  {s.surfaces.length} {s.surfaces.length === 1 ? 'face' : 'faces'} · {s.savedAt ? new Date(s.savedAt).toLocaleString() : 'unknown date'}
                </div>
              </div>
              <button className={btn} onClick={() => load(s)}>
                Load
              </button>
              <button className={btn} onClick={() => twoStep(`del:${s.name}`, () => remove(s.name))}>
                {confirming === `del:${s.name}` ? 'Sure?' : 'Delete'}
              </button>
            </li>
          ))}
        </ul>

        <div className="flex flex-wrap gap-2">
          <button className={btn} onClick={exportFile}>
            Export file
          </button>
          <label className={`${btn} cursor-pointer`}>
            Import file
            <input type="file" accept="application/json,.json" className="hidden" onChange={importFile} />
          </label>
          <button className={btn} onClick={() => twoStep('fresh', onStartFresh)}>
            {confirming === 'fresh' ? 'Sure? Resets all faces' : 'Start fresh'}
          </button>
        </div>

        <button className="mt-2 self-center rounded-lg bg-cyan-500 px-6 py-3 font-medium text-black" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
