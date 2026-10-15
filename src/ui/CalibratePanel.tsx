import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { applyCalibration, tapToCamera, tapsToCorners } from '../calibrate/corners';
import type { ScanMap } from '../calibrate/decode';
import { buildCameraLink, newSessionId } from '../calibrate/link';
import { calibrationSetupName } from '../calibrate/names';
import { SETTLE_MS, STEP_PX, frameCount, frameSpec } from '../calibrate/patterns';
import { encodeCalibMsg, parseCalibMsg, type CalibMsg } from '../calibrate/protocol';
import { createRelayClient, type RelayClient } from '../calibrate/relay-client';
import { createScanGate, type ScanGate } from '../calibrate/scan-gate';
import { runScan } from '../calibrate/scan-driver';
import { CHANNEL, parseMsg } from '../output/protocol';
import { MAX_SETUPS, normalizeName, saveSetup, type KeyValueStore } from '../setups/setups';
import type { Surface } from '../surfaces/types';
import type { Corners, Vec2 } from '../warp/types';
import { QrCode } from './QrCode';

interface Props {
  surfaces: Surface[];
  onApply: (list: Surface[]) => void;
  onClose: () => void;
  /** Opens the Output window (the Editor toolbar is hidden behind this panel). */
  onOpenOutput: () => void;
  /** Browser storage for saved setups, or null when it is blocked (private window). */
  store: KeyValueStore | null;
}

const SAVE_ERRORS = {
  'bad-name': 'Give the setup a name (1 to 40 characters).',
  'bad-surfaces': 'This result cannot be saved.',
  full: `You already have ${MAX_SETUPS} setups: delete one in Setups first.`,
  storage: "Saving isn't available in this browser mode.",
} as const;

type Stage = 'connect' | 'scanning' | 'decoding' | 'tap';
interface ActiveScan {
  gw: number;
  gh: number;
  gate: ScanGate;
}
const FRAME_DONE_TIMEOUT_MS = 8000;
const DECODE_TIMEOUT_MS = 30_000;
const CORNER_NAMES = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
const btn = 'rounded-lg px-4 py-3 font-medium disabled:opacity-40';

/** Pair a phone, run the scan, tap the corners, and apply the result. A modal panel over the Editor. */
export function CalibratePanel({ surfaces, onApply, onClose, onOpenOutput, store }: Props) {
  const session = useMemo(() => newSessionId(), []);
  const [addresses, setAddresses] = useState<string[] | null>(null);
  const [phone, setPhone] = useState<{ width: number; height: number } | null>(null);
  const [output, setOutput] = useState<{ w: number; h: number; fullscreen: boolean } | null>(null);
  const [stage, setStage] = useState<Stage>('connect');
  const [progress, setProgress] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<{ map: ScanMap; preview: string } | null>(null);
  const [faceIds, setFaceIds] = useState<string[]>([]);
  const [faceIndex, setFaceIndex] = useState(0);
  const [taps, setTaps] = useState<Vec2[]>([]);
  const [solved, setSolved] = useState<Record<string, Corners>>({});
  const [saveName, setSaveName] = useState(() => calibrationSetupName(new Date()));
  const [saveStatus, setSaveStatus] = useState<{ text: string; error: boolean } | null>(null);

  const relayRef = useRef<RelayClient | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  /** One signal object per scan, so an old runScan can never be revived by a new Start. */
  const signalRef = useRef<{ cancelled: boolean }>({ cancelled: false });
  const frameWaitRef = useRef<{ frame: number; resolve: () => void; reject: (e: Error) => void } | null>(null);
  const projectorRef = useRef<{ w: number; h: number } | null>(null);
  /** The scan in progress (scanning or decoding); null when none. A result is accepted only against this. */
  const activeScanRef = useRef<ActiveScan | null>(null);
  const decodeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const surfacesRef = useRef(surfaces);
  surfacesRef.current = surfaces;

  const sendPhone = (msg: CalibMsg) => void relayRef.current?.send(encodeCalibMsg(msg));
  const showNormal = () => {
    try {
      channelRef.current?.postMessage({ type: 'scan-frame', spec: null, gw: 1, gh: 1, pw: 1, ph: 1 });
    } catch {
      // channel already closed
    }
  };
  const clearDecodeTimer = () => {
    if (decodeTimerRef.current !== null) clearTimeout(decodeTimerRef.current);
    decodeTimerRef.current = null;
  };

  useEffect(() => {
    const relay = createRelayClient(session, 'laptop');
    relayRef.current = relay;
    const ch = new BroadcastChannel(CHANNEL);
    channelRef.current = ch;

    relay.onMessage((text) => {
      const msg = parseCalibMsg(text);
      if (!msg) return;
      if (msg.type === 'hello') setPhone({ width: msg.width, height: msg.height });
      else if (msg.type === 'frame-done') {
        const w = frameWaitRef.current;
        if (w && w.frame === msg.frame) {
          frameWaitRef.current = null;
          activeScanRef.current?.gate.frameDone(msg.frame);
          w.resolve();
        }
      } else if (msg.type === 'error') {
        if (!activeScanRef.current) return; // nothing running: a stale report
        activeScanRef.current = null;
        clearDecodeTimer();
        signalRef.current.cancelled = true;
        frameWaitRef.current?.reject(new Error('phone reported a problem'));
        frameWaitRef.current = null;
        showNormal();
        setStage('connect');
        setMessage(
          msg.reason === 'moved'
            ? 'The phone moved during the scan. Hold it still and try again.'
            : msg.reason === 'dark'
              ? 'The phone did not see the projector picture. Aim at the box and dim the room.'
              : `The phone stopped the scan (${msg.reason}). Try again.`,
        );
      } else if (msg.type === 'scan-result') {
        const active = activeScanRef.current;
        // Only a result for the scan we are running; anything else is stale or unexpected.
        if (!active || !active.gate.canAcceptResult() || msg.map.gw !== active.gw || msg.map.gh !== active.gh) return;
        activeScanRef.current = null;
        clearDecodeTimer();
        signalRef.current.cancelled = true; // the scan is over; stop the driver
        const w = frameWaitRef.current;
        frameWaitRef.current = null;
        w?.resolve();
        showNormal();
        setResult({ map: msg.map, preview: msg.preview });
        setFaceIds(surfacesRef.current.map((s) => s.id));
        setFaceIndex(0);
        setTaps([]);
        setSolved({});
        setMessage(null);
        setStage('tap');
      }
    });

    ch.onmessage = (ev) => {
      const msg = parseMsg(ev.data);
      if (msg?.type === 'output-size') setOutput({ w: msg.w, h: msg.h, fullscreen: msg.fullscreen });
    };
    ch.postMessage({ type: 'probe' });

    fetch('/calib/info', { cache: 'no-store' })
      .then((r) => r.json() as Promise<{ addresses?: string[] }>)
      .then((d) => setAddresses(Array.isArray(d.addresses) ? d.addresses.filter((a) => typeof a === 'string') : []))
      .catch(() => setAddresses([]));

    return () => {
      signalRef.current.cancelled = true;
      clearDecodeTimer();
      frameWaitRef.current?.reject(new Error('closed'));
      frameWaitRef.current = null;
      // Tell the phone to stop only if a scan was running; a closed relay must never throw here.
      if (activeScanRef.current) {
        activeScanRef.current = null;
        try {
          void relay.send(encodeCalibMsg({ type: 'scan-cancel' }));
        } catch {
          // relay already closed
        }
      }
      try {
        ch.postMessage({ type: 'scan-frame', spec: null, gw: 1, gh: 1, pw: 1, ph: 1 });
      } catch {
        // channel already closed
      }
      ch.close();
      channelRef.current = null;
      relay.close();
    };
  }, [session]);

  const cameraLink = useMemo(() => {
    if (addresses === null) return null;
    const isLan = !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    const host = isLan ? location.hostname : addresses[0];
    return host ? buildCameraLink(host, location.port, location.protocol, session) : null;
  }, [addresses, session]);

  // Every usable address as a copyable link (the first one is what the QR code holds when opened on localhost).
  const altLinks = useMemo(() => {
    if (!addresses || addresses.length < 2) return [];
    const isLan = !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    if (isLan) return [];
    return addresses.map((a) => buildCameraLink(a, location.port, location.protocol, session));
  }, [addresses, session]);

  const startScan = async () => {
    if (!output || !phone || activeScanRef.current) return;
    const pw = output.w;
    const ph = output.h;
    projectorRef.current = { w: pw, h: ph };
    const gw = Math.ceil(pw / STEP_PX);
    const gh = Math.ceil(ph / STEP_PX);
    const total = frameCount(gw, gh);
    const signal = { cancelled: false };
    signalRef.current = signal;
    const scan: ActiveScan = { gw, gh, gate: createScanGate(total) };
    activeScanRef.current = scan;
    setMessage(null);
    setStage('scanning');
    setProgress(`0 / ${total}`);
    sendPhone({ type: 'scan-start', gw, gh });
    try {
      const outcome = await runScan(
        total,
        {
          showFrame: (i) => channelRef.current?.postMessage({ type: 'scan-frame', spec: frameSpec(i, gw, gh), gw, gh, pw, ph }),
          settle: () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS)),
          capture: (i) =>
            new Promise<void>((resolve, reject) => {
              const wait = {
                frame: i,
                resolve: () => {
                  clearTimeout(timer);
                  resolve();
                },
                reject: (e: Error) => {
                  clearTimeout(timer);
                  reject(e);
                },
              };
              const timer = setTimeout(() => {
                if (frameWaitRef.current === wait) frameWaitRef.current = null;
                reject(new Error('the phone stopped answering'));
              }, FRAME_DONE_TIMEOUT_MS);
              frameWaitRef.current = wait;
              sendPhone({ type: 'show', frame: i, of: total });
            }),
          onProgress: (d, t) => setProgress(`${d} / ${t}`),
        },
        signal,
      );
      if (signalRef.current === signal) showNormal();
      // Only move on if this scan is still the running one (a result may already have arrived).
      if (outcome === 'done' && activeScanRef.current === scan) {
        setStage((s) => (s === 'scanning' ? 'decoding' : s));
        clearDecodeTimer();
        decodeTimerRef.current = setTimeout(() => {
          if (activeScanRef.current !== scan) return;
          activeScanRef.current = null;
          decodeTimerRef.current = null;
          signalRef.current.cancelled = true;
          sendPhone({ type: 'scan-cancel' });
          setStage((s) => (s === 'decoding' ? 'connect' : s));
          setMessage('The phone did not send the result. Try again.');
        }, DECODE_TIMEOUT_MS);
      }
    } catch (e) {
      // Only the latest scan may touch the projector, the phone and the stage.
      if (signalRef.current !== signal) return;
      showNormal();
      sendPhone({ type: 'scan-cancel' });
      if (!signal.cancelled && activeScanRef.current === scan) {
        activeScanRef.current = null;
        setStage((s) => (s === 'scanning' ? 'connect' : s));
        setMessage(e instanceof Error ? `Scan stopped: ${e.message}.` : 'Scan stopped.');
      }
    }
  };

  const cancelScan = () => {
    activeScanRef.current = null;
    clearDecodeTimer();
    signalRef.current.cancelled = true;
    frameWaitRef.current?.reject(new Error('cancelled'));
    frameWaitRef.current = null;
    sendPhone({ type: 'scan-cancel' });
    showNormal();
    setStage('connect');
  };

  const scanAgain = () => {
    setResult(null);
    setTaps([]);
    setSolved({});
    setFaceIndex(0);
    setMessage(null);
    setStage('connect');
  };

  const onPictureTap = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!result || !projectorRef.current || faceIndex >= faceIds.length) return;
    try {
      // currentTarget is the box that tightly wraps the <img> (inline-block, no padding or border).
      const rect = e.currentTarget.getBoundingClientRect();
      const tap = tapToCamera(e.clientX, e.clientY, rect, result.map.width, result.map.height);
      if (!tap) return;
      const next = [...taps, tap];
      if (next.length < 4) {
        setTaps(next);
        setMessage(null);
        return;
      }
      const r = tapsToCorners(result.map, next as [Vec2, Vec2, Vec2, Vec2], projectorRef.current);
      if (r.ok) {
        setSolved((s) => ({ ...s, [faceIds[faceIndex]]: r.corners }));
        setTaps([]);
        setFaceIndex(faceIndex + 1);
        setMessage(null);
      } else {
        setTaps([]);
        setMessage(
          r.reason === 'unlit'
            ? `The ${r.failed.map((i) => CORNER_NAMES[i]).join(' and ')} tap was not on a lit part of the box. Tap that face again.`
            : 'Those corners do not make a proper shape. Tap them again in order: top-left, top-right, bottom-right, bottom-left.',
        );
      }
    } catch {
      setTaps([]);
      setMessage('Could not work out that face. Tap its four corners again.');
    }
  };

  const skipFace = () => {
    setTaps([]);
    setFaceIndex(faceIndex + 1);
    setMessage(null);
  };

  const apply = () => {
    // Applied by id to the CURRENT surfaces; ids that no longer exist are ignored.
    onApply(applyCalibration(surfaces, solved));
    onClose();
  };

  /** Store the layout as it would look after Apply as a named setup; the current pins are not touched. */
  const saveResult = () => {
    if (!store) return;
    const result = saveSetup(store, saveName, applyCalibration(surfaces, solved), Date.now());
    if (!result.ok) {
      setSaveStatus({ text: SAVE_ERRORS[result.reason], error: true });
      return;
    }
    setSaveStatus({ text: `${result.replaced ? 'Replaced' : 'Saved'} "${normalizeName(saveName)}". Find it under Setups.`, error: false });
  };

  const solvedCount = Object.keys(solved).length;
  const hasFace = faceIndex < faceIds.length;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-auto bg-black/80 p-4">
      <div className="w-full max-w-3xl space-y-4 rounded-xl bg-zinc-900 p-4 text-sm select-text">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Camera calibration</h2>
          <button className={`${btn} bg-zinc-700`} onClick={onClose}>
            {stage === 'tap' && solvedCount > 0 ? 'Cancel' : 'Close'}
          </button>
        </div>

        {message && <p className="rounded-lg bg-amber-900/60 p-3 text-amber-200">{message}</p>}

        {(stage === 'connect' || stage === 'scanning' || stage === 'decoding') && (
          <div className="space-y-3">
            <ol className="list-decimal space-y-1 pl-5 text-zinc-300">
              <li>Scan this code with the phone and allow the camera. Point the phone at the box and hold it still.</li>
              <li>Press <b>Open output window</b> below. A small window opens: drag it onto the projector screen, then click inside it once to make it fullscreen.</li>
              <li>Press <b>Start scan</b>. The projector flashes for about 20 to 30 seconds.</li>
            </ol>
            <div className="flex flex-wrap items-center gap-4">
              {cameraLink ? (
                <div className="space-y-1">
                  <QrCode text={cameraLink} className="h-44 w-44 rounded bg-white" />
                  <p className="max-w-xs break-all text-xs text-zinc-400">{cameraLink}</p>
                  {altLinks.length > 1 && (
                    <div className="max-w-xs space-y-1 text-xs text-zinc-400">
                      <p>Not working? Try another address:</p>
                      <ul className="space-y-1">
                        {altLinks.map((l, i) => (
                          <li key={l} className="break-all">
                            {l}
                            {i === 0 ? ' (in the QR code)' : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ) : (
                <p className="max-w-xs text-amber-300">
                  {addresses === null
                    ? 'Looking for this computer’s network address…'
                    : 'Could not find a network address. Open the app from the phone’s address instead of localhost, or check Wi-Fi.'}
                </p>
              )}
              <ul className="space-y-2">
                <li>
                  <button className={`${btn} bg-zinc-700`} onClick={onOpenOutput}>
                    Open output window
                  </button>
                </li>
                <li>Phone: {phone ? `connected (${phone.width}×${phone.height})` : 'waiting…'}</li>
                <li>
                  Output window:{' '}
                  {output ? `${output.w}×${output.h}${output.fullscreen ? ' (fullscreen)' : ' (NOT fullscreen)'}` : 'not open'}
                </li>
              </ul>
            </div>
            {output && !output.fullscreen && (
              <p className="text-amber-300">
                The Output window is not fullscreen, so the pins would fit this window, not the projector. Click the Output window once to make it
                fullscreen on the projector.
              </p>
            )}
            <div className="flex items-center gap-3">
              <button
                className={`${btn} ${phone && output && stage === 'connect' ? 'bg-cyan-500 text-black' : 'bg-zinc-700 text-zinc-400'}`}
                disabled={!phone || !output || stage !== 'connect'}
                onClick={() => void startScan()}
              >
                Start scan
              </button>
              {stage === 'scanning' && <span>Scanning… {progress}</span>}
              {stage === 'decoding' && <span>Waiting for the phone to finish…</span>}
              {(stage === 'scanning' || stage === 'decoding') && (
                <button className={`${btn} bg-zinc-700`} onClick={cancelScan}>
                  Stop
                </button>
              )}
            </div>
          </div>
        )}

        {stage === 'tap' && result && (
          <div className="space-y-3">
            {hasFace ? (
              <p>
                Face {faceIndex + 1} of {faceIds.length}: tap its corners on the picture in this order: top-left, top-right, bottom-right,
                bottom-left. Next: <b>{CORNER_NAMES[taps.length]}</b>.
              </p>
            ) : (
              <p>All faces done. Press Apply to use the new pins, or Cancel.</p>
            )}
            {/* The inline-block wrapper shrink-wraps the picture, so its rectangle IS the picture (no letterboxing). */}
            <div className="relative inline-block touch-none select-none" onPointerDown={onPictureTap}>
              <img src={result.preview} alt="What the phone saw" className="block max-h-[70vh] w-auto max-w-full" draggable={false} />
              <svg
                className="pointer-events-none absolute inset-0 h-full w-full"
                viewBox={`0 0 ${result.map.width} ${result.map.height}`}
                preserveAspectRatio="none"
              >
                {taps.length > 1 && <polyline points={taps.map((t) => t.join(',')).join(' ')} fill="none" stroke="#22d3ee" strokeWidth={2} />}
                {taps.map((t, i) => (
                  <circle key={i} cx={t[0]} cy={t[1]} r={5} fill="#22d3ee" />
                ))}
              </svg>
            </div>
            <div className="flex flex-wrap gap-2">
              <button className={`${btn} bg-zinc-700`} disabled={taps.length === 0} onClick={() => setTaps(taps.slice(0, -1))}>
                Undo tap
              </button>
              <button className={`${btn} bg-zinc-700`} disabled={!hasFace} onClick={skipFace}>
                Skip this face
              </button>
              <button className={`${btn} bg-zinc-700`} onClick={scanAgain}>
                Scan again
              </button>
              <button
                className={`${btn} ${solvedCount > 0 ? 'bg-cyan-500 text-black' : 'bg-zinc-700 text-zinc-400'}`}
                disabled={solvedCount === 0}
                onClick={apply}
              >
                Apply ({solvedCount} {solvedCount === 1 ? 'face' : 'faces'})
              </button>
            </div>
            {solvedCount > 0 && (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    className="min-w-0 flex-1 select-text rounded-lg bg-zinc-800 px-3 py-2 text-base text-white"
                    placeholder="Setup name"
                    maxLength={40}
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                  />
                  <button
                    className={`${btn} ${store ? 'bg-zinc-700' : 'bg-zinc-800 text-zinc-500'}`}
                    disabled={!store}
                    title={store ? undefined : "Saving isn't available in this browser mode"}
                    onClick={saveResult}
                  >
                    Save result as setup
                  </button>
                </div>
                {saveStatus && <p className={saveStatus.error ? 'text-amber-300' : 'text-emerald-300'}>{saveStatus.text}</p>}
              </div>
            )}
            <p className="text-xs text-zinc-400">
              Apply replaces the corners of the faces you tapped. Save result as setup keeps the new pins in Setups without changing your current
              ones. Save a setup first if you also want to keep the old pins.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
