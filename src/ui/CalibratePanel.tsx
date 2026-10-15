import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { applyCalibration, tapToCamera, tapsToCorners } from '../calibrate/corners';
import type { ScanMap } from '../calibrate/decode';
import { buildCameraLink, newSessionId } from '../calibrate/link';
import { SETTLE_MS, STEP_PX, frameCount, frameSpec } from '../calibrate/patterns';
import { encodeCalibMsg, parseCalibMsg, type CalibMsg } from '../calibrate/protocol';
import { createRelayClient, type RelayClient } from '../calibrate/relay-client';
import { runScan } from '../calibrate/scan-driver';
import { CHANNEL, parseMsg } from '../output/protocol';
import type { Surface } from '../surfaces/types';
import type { Corners, Vec2 } from '../warp/types';
import { QrCode } from './QrCode';

interface Props {
  surfaces: Surface[];
  onApply: (list: Surface[]) => void;
  onClose: () => void;
}

type Stage = 'connect' | 'scanning' | 'decoding' | 'tap';
const FRAME_DONE_TIMEOUT_MS = 8000;
const CORNER_NAMES = ['top-left', 'top-right', 'bottom-right', 'bottom-left'];
const btn = 'rounded-lg px-4 py-3 font-medium';

/** Pair a phone, run the scan, tap the corners, and apply the result. A modal panel over the Editor. */
export function CalibratePanel({ surfaces, onApply, onClose }: Props) {
  const session = useMemo(() => newSessionId(), []);
  const [addresses, setAddresses] = useState<string[] | null>(null);
  const [phone, setPhone] = useState<{ width: number; height: number } | null>(null);
  const [output, setOutput] = useState<{ w: number; h: number; fullscreen: boolean } | null>(null);
  const [stage, setStage] = useState<Stage>('connect');
  const [progress, setProgress] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [result, setResult] = useState<{ map: ScanMap; preview: string } | null>(null);
  const [faceIndex, setFaceIndex] = useState(0);
  const [taps, setTaps] = useState<Vec2[]>([]);
  const [solved, setSolved] = useState<Record<string, Corners>>({});

  const relayRef = useRef<RelayClient | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const signalRef = useRef({ cancelled: false });
  const frameWaitRef = useRef<{ frame: number; resolve: () => void; reject: (e: Error) => void } | null>(null);
  const projectorRef = useRef<{ w: number; h: number } | null>(null);
  const scanActiveRef = useRef(false);

  const sendPhone = (msg: CalibMsg) => void relayRef.current?.send(encodeCalibMsg(msg));
  const showNormal = () =>
    channelRef.current?.postMessage({ type: 'scan-frame', spec: null, gw: 1, gh: 1, pw: 1, ph: 1 });

  useEffect(() => {
    const relay = createRelayClient(session, 'laptop');
    relayRef.current = relay;
    const ch = new BroadcastChannel(CHANNEL);
    channelRef.current = ch;
    const signal = signalRef.current;

    relay.onMessage((text) => {
      const msg = parseCalibMsg(text);
      if (!msg) return;
      if (msg.type === 'hello') setPhone({ width: msg.width, height: msg.height });
      else if (msg.type === 'frame-done') {
        const w = frameWaitRef.current;
        if (w && w.frame === msg.frame) {
          frameWaitRef.current = null;
          w.resolve();
        }
      } else if (msg.type === 'error') {
        scanActiveRef.current = false;
        signal.cancelled = true;
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
        scanActiveRef.current = false;
        setResult({ map: msg.map, preview: msg.preview });
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
      signal.cancelled = true;
      frameWaitRef.current?.reject(new Error('closed'));
      frameWaitRef.current = null;
      // Tell the phone to stop only if a scan was running; a closed relay must never throw here.
      if (scanActiveRef.current) {
        scanActiveRef.current = false;
        try {
          void relay.send(encodeCalibMsg({ type: 'scan-cancel' }));
        } catch {
          // relay already closed
        }
      }
      ch.postMessage({ type: 'scan-frame', spec: null, gw: 1, gh: 1, pw: 1, ph: 1 });
      ch.close();
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
    if (!output || !phone) return;
    const pw = output.w;
    const ph = output.h;
    projectorRef.current = { w: pw, h: ph };
    const gw = Math.ceil(pw / STEP_PX);
    const gh = Math.ceil(ph / STEP_PX);
    const total = frameCount(gw, gh);
    const signal = signalRef.current;
    signal.cancelled = false;
    setMessage(null);
    setStage('scanning');
    setProgress(`0 / ${total}`);
    scanActiveRef.current = true;
    sendPhone({ type: 'scan-start', gw, gh });
    try {
      const outcome = await runScan(
        total,
        {
          showFrame: (i) => channelRef.current?.postMessage({ type: 'scan-frame', spec: frameSpec(i, gw, gh), gw, gh, pw, ph }),
          settle: () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS)),
          capture: (i) =>
            new Promise<void>((resolve, reject) => {
              const timer = setTimeout(() => {
                frameWaitRef.current = null;
                reject(new Error('the phone stopped answering'));
              }, FRAME_DONE_TIMEOUT_MS);
              frameWaitRef.current = {
                frame: i,
                resolve: () => {
                  clearTimeout(timer);
                  resolve();
                },
                reject: (e) => {
                  clearTimeout(timer);
                  reject(e);
                },
              };
              sendPhone({ type: 'show', frame: i, of: total });
            }),
          onProgress: (d, t) => setProgress(`${d} / ${t}`),
        },
        signal,
      );
      showNormal();
      if (outcome === 'done') {
        setStage('decoding');
        setMessage('Working out the picture…');
      }
    } catch (e) {
      scanActiveRef.current = false;
      showNormal();
      sendPhone({ type: 'scan-cancel' });
      if (!signal.cancelled) {
        setStage('connect');
        setMessage(e instanceof Error ? `Scan stopped: ${e.message}.` : 'Scan stopped.');
      }
    }
  };

  const cancelScan = () => {
    scanActiveRef.current = false;
    signalRef.current.cancelled = true;
    frameWaitRef.current?.reject(new Error('cancelled'));
    frameWaitRef.current = null;
    sendPhone({ type: 'scan-cancel' });
    showNormal();
    setStage('connect');
  };

  const onPictureTap = (e: PointerEvent<HTMLDivElement>) => {
    if (!result || !projectorRef.current || faceIndex >= surfaces.length) return;
    try {
      // currentTarget is the box that tightly wraps the <img> (no padding, border or letterboxing).
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
        setSolved((s) => ({ ...s, [surfaces[faceIndex].id]: r.corners }));
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
    onApply(applyCalibration(surfaces, solved));
    onClose();
  };

  const solvedCount = Object.keys(solved).length;
  const face = surfaces[faceIndex];

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
              <li>Press <b>Open output window</b> in the toolbar, drag it to the projector and click it once for fullscreen.</li>
              <li>Press <b>Start scan</b>. The projector flashes for about 15 seconds.</li>
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
              <ul className="space-y-1">
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
              {stage === 'scanning' && (
                <>
                  <span>Scanning… {progress}</span>
                  <button className={`${btn} bg-zinc-700`} onClick={cancelScan}>
                    Stop
                  </button>
                </>
              )}
              {stage === 'decoding' && <span>Waiting for the phone to finish…</span>}
            </div>
          </div>
        )}

        {stage === 'tap' && result && (
          <div className="space-y-3">
            {face ? (
              <p>
                Face {faceIndex + 1} of {surfaces.length}: tap its corners on the picture in this order: top-left, top-right, bottom-right,
                bottom-left. Next: <b>{CORNER_NAMES[taps.length]}</b>.
              </p>
            ) : (
              <p>All faces done. Press Apply to use the new pins, or Cancel.</p>
            )}
            <div className="relative touch-none select-none" onPointerDown={onPictureTap}>
              <img src={result.preview} alt="What the phone saw" className="block w-full" draggable={false} />
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
              <button className={`${btn} bg-zinc-700`} disabled={!face} onClick={skipFace}>
                Skip this face
              </button>
              <button
                className={`${btn} ${solvedCount > 0 ? 'bg-cyan-500 text-black' : 'bg-zinc-700 text-zinc-400'}`}
                disabled={solvedCount === 0}
                onClick={apply}
              >
                Apply ({solvedCount} {solvedCount === 1 ? 'face' : 'faces'})
              </button>
            </div>
            <p className="text-xs text-zinc-400">Apply replaces the corners of the faces you tapped. Save a setup first if you want to keep the old pins.</p>
          </div>
        )}
      </div>
    </div>
  );
}
