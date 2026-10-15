import { useEffect, useMemo, useRef, useState } from 'react';
import { useWakeLock } from '../ui/wakeLock';
import { analysisSize } from './analysis-size';
import { decodeScan } from './decode';
import { accumulateLuma, finishLuma } from './luma';
import { CAPTURE_FRAMES, frameCount } from './patterns';
import { encodeCalibMsg, parseCalibMsg, type CalibMsg } from './protocol';
import { createRelayClient, type RelayClient } from './relay-client';
import { MOTION_LIMITS, isMoving, magnitude } from './steady';

const FRAME_GAP_MS = 40;
/** Under this share of lit pixels the scan is treated as "the projector is not on the box". */
const MIN_LIT_SHARE = 0.05;

type Stage = 'start' | 'live' | 'scanning' | 'done' | 'error';

interface Scan {
  gw: number;
  gh: number;
  total: number;
  frames: Uint8ClampedArray[];
  preview: string;
}

const SYNC_TIMEOUT_MS = 10_000;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The phone side: shows the camera, answers the laptop's scan, decodes it and sends the map back. */
export function CameraApp() {
  const session = useMemo(() => {
    const s = new URLSearchParams(location.search).get('s') ?? '';
    return /^[0-9a-f]{32}$/.test(s) ? s : null;
  }, []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const relayRef = useRef<RelayClient | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dimsRef = useRef({ w: 0, h: 0 });
  const scanRef = useRef<Scan | null>(null);
  const movedRef = useRef(false);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const startedRef = useRef(false);
  const mountedRef = useRef(true);
  const streamRef = useRef<MediaStream | null>(null);
  const motionSeenRef = useRef(false);
  const [motionChecked, setMotionChecked] = useState(true);
  const [stage, setStage] = useState<Stage>(session ? 'start' : 'error');
  const [status, setStatus] = useState(session ? 'Tap Start, then point the phone at the box.' : 'This link is not valid: scan the QR code again.');
  const [progress, setProgress] = useState('');
  useWakeLock(stage === 'live' || stage === 'scanning' || stage === 'done');

  const send = (msg: CalibMsg) => void relayRef.current?.send(encodeCalibMsg(msg));
  /** Like send, but reports whether the server accepted it. */
  const sendChecked = async (msg: CalibMsg): Promise<boolean> => (await relayRef.current?.send(encodeCalibMsg(msg))) ?? false;

  const fail = (reason: 'moved' | 'camera' | 'timeout' | 'dark' | 'other', detail?: string, text?: string) => {
    scanRef.current = null;
    send(detail === undefined ? { type: 'error', reason } : { type: 'error', reason, detail });
    setStage('live');
    setStatus(text ?? 'The scan stopped. Press Start scan on the laptop to try again.');
  };

  /** Average CAPTURE_FRAMES camera frames into one grey frame. */
  const grabGray = async (): Promise<Uint8ClampedArray> => {
    const { w, h } = dimsRef.current;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const acc = new Uint16Array(w * h);
    for (let i = 0; i < CAPTURE_FRAMES; i++) {
      ctx.drawImage(videoRef.current!, 0, 0, w, h);
      accumulateLuma(ctx.getImageData(0, 0, w, h).data, acc);
      if (i < CAPTURE_FRAMES - 1) await wait(FRAME_GAP_MS);
    }
    return finishLuma(acc, CAPTURE_FRAMES);
  };

  const capture = async (frame: number, of: number) => {
    const scan = scanRef.current;
    if (!scan) return;
    if (of !== scan.total) return fail('other', 'frame count mismatch');
    if (frame !== scan.frames.length) return fail('other', 'frame out of order');
    if (movedRef.current) return fail('moved', undefined, 'The phone moved during the scan. Hold it still and try again.');
    const gray = await grabGray();
    // The scan may have been cancelled, failed or replaced while the camera was being read.
    if (scanRef.current !== scan) return;
    if (frame === 0) scan.preview = canvasRef.current!.toDataURL('image/jpeg', 0.7);
    scan.frames.push(gray);
    if (movedRef.current) return fail('moved', undefined, 'The phone moved during the scan. Hold it still and try again.');
    setProgress(`${scan.frames.length} / ${scan.total}`);
    // Wait for the laptop to be told before decoding, so scan-result can never overtake the last frame-done.
    const told = await sendChecked({ type: 'frame-done', frame });
    if (scanRef.current !== scan) return;
    if (!told) return fail('other', 'could not reach the laptop', 'Lost the connection to the laptop. Try again.');
    if (scan.frames.length === scan.total) await finish(scan);
  };

  const finish = async (scan: Scan) => {
    if (scanRef.current !== scan) return;
    setStatus('Working out the picture…');
    await wait(30); // let the status paint before the heavy loop
    if (scanRef.current !== scan) return; // cancelled or failed during the pause
    const { w, h } = dimsRef.current;
    try {
      const map = decodeScan(scan.frames, w, h, scan.gw, scan.gh);
      let lit = 0;
      for (let p = 0; p < map.mask.length; p++) lit += map.mask[p];
      if (lit / map.mask.length < MIN_LIT_SHARE) {
        return fail('dark', undefined, 'The projector picture was not seen. Aim at the box and dim the room.');
      }
      scanRef.current = null;
      const sent = await sendChecked({ type: 'scan-result', map, preview: scan.preview });
      if (!sent) return fail('other', 'result too large or server refused it', 'Could not send the scan to the laptop. Try again.');
      setStage('done');
      setStatus('Done. Tap the box corners on the laptop.');
    } catch (e) {
      fail('other', e instanceof Error ? e.message.slice(0, 150) : 'decode failed');
    }
  };

  const onMessage = (text: string) => {
    const msg = parseCalibMsg(text);
    if (!msg) return;
    if (msg.type === 'scan-start') {
      const total = frameCount(msg.gw, msg.gh);
      movedRef.current = false;
      scanRef.current = { gw: msg.gw, gh: msg.gh, total, frames: [], preview: '' };
      queueRef.current = Promise.resolve();
      setStage('scanning');
      setStatus('Scanning: hold the phone still.');
      setProgress(`0 / ${total}`);
    } else if (msg.type === 'show') {
      queueRef.current = queueRef.current.then(() => capture(msg.frame, msg.of)).catch(() => fail('other', 'capture failed'));
    } else if (msg.type === 'scan-cancel') {
      if (!scanRef.current) return;
      scanRef.current = null;
      setStage('live');
      setStatus('Scan cancelled.');
    }
  };

  const start = async () => {
    if (!session || startedRef.current) return;
    startedRef.current = true;
    let stream: MediaStream | null = null;
    try {
      // iOS asks for motion access from a tap. Guard: some browsers have no DeviceMotionEvent at all.
      let motionOk = typeof DeviceMotionEvent !== 'undefined';
      if (motionOk) {
        const DME = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
        if (typeof DME.requestPermission === 'function') motionOk = (await DME.requestPermission().catch(() => 'denied')) === 'granted';
      }
      motionSeenRef.current = false;
      setMotionChecked(motionOk);
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      if (!mountedRef.current) {
        // The page went away while the permission prompt was open: do not keep the camera.
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = stream;
      const video = videoRef.current!;
      video.srcObject = stream;
      await video.play();
      if (!mountedRef.current) return;
      const track = stream.getVideoTracks()[0];
      // Best effort: stop the camera re-adjusting its exposure while the projector flashes.
      await track.applyConstraints({ advanced: [{ exposureMode: 'manual' } as MediaTrackConstraintSet] }).catch(() => {});
      if (!mountedRef.current) return;
      const { w, h } = analysisSize(video.videoWidth, video.videoHeight);
      dimsRef.current = { w, h };
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvasRef.current = canvas;
      relayRef.current?.close();
      const relay = createRelayClient(session, 'phone', undefined, { skipBacklog: true });
      relayRef.current = relay;
      relay.onMessage(onMessage);
      // Only announce ourselves once old mailbox contents are skipped, so a stale scan can never replay.
      setStatus('Connecting to the laptop…');
      const synced = await Promise.race([relay.synced.then(() => true), wait(SYNC_TIMEOUT_MS).then(() => false)]);
      if (!mountedRef.current) return;
      if (!synced) {
        relay.close();
        relayRef.current = null;
        startedRef.current = false;
        setStage('error');
        setStatus('Could not reach the laptop. Check both are on the same Wi-Fi, then tap Start camera again.');
        return;
      }
      const hello = await sendChecked({ type: 'hello', width: w, height: h });
      if (!mountedRef.current) return;
      if (!hello) {
        relay.close();
        relayRef.current = null;
        startedRef.current = false;
        setStage('error');
        setStatus('The laptop server is busy. Close old calibration tabs or wait a few minutes, then tap Start again.');
        return;
      }
      send({ type: 'ready' });
      setStage('live');
      setStatus('Connected. Point the phone at the box, then press Start scan on the laptop.');
      if (motionOk) {
        // No motion events after a second means no sensor (or no permission): say so.
        setTimeout(() => {
          if (!motionSeenRef.current) setMotionChecked(false);
        }, 1000);
      }
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      if (!mountedRef.current) return;
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      startedRef.current = false;
      setStage('error');
      setStatus(e instanceof Error ? `Could not start the camera: ${e.message}` : 'Could not start the camera.');
    }
  };

  useEffect(() => {
    const onMotion = (ev: DeviceMotionEvent) => {
      motionSeenRef.current = true;
      if (!scanRef.current) return;
      const r = ev.rotationRate;
      const a = ev.acceleration;
      if (isMoving({ rotation: magnitude(r?.alpha, r?.beta, r?.gamma), accel: magnitude(a?.x, a?.y, a?.z) }, MOTION_LIMITS)) {
        movedRef.current = true;
      }
    };
    window.addEventListener('devicemotion', onMotion);
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      window.removeEventListener('devicemotion', onMotion);
      relayRef.current?.close();
      // React clears videoRef before passive cleanups run, so the stream is kept in its own ref.
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, []);

  return (
    <div className="fixed inset-0 select-none bg-black text-white">
      <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-contain" />
      <div className="absolute inset-x-0 bottom-0 space-y-2 bg-black/70 p-4 text-base">
        <p>{status}</p>
        {stage === 'scanning' && <p className="text-zinc-300">{progress}</p>}
        {!motionChecked && (stage === 'live' || stage === 'scanning') && <p className="text-amber-300">Motion check is off: hold the phone very still.</p>}
        {(stage === 'start' || (stage === 'error' && session)) && (
          <button className="rounded-lg bg-cyan-500 px-5 py-3 font-medium text-black" onClick={() => void start()}>
            Start camera
          </button>
        )}
      </div>
    </div>
  );
}
