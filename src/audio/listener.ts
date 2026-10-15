// Microphone listener (DOM / Web Audio only; no unit test for the DOM parts because tests run in Node.
// The pure helper listenResultForError is unit-tested).
// The analyser is never connected to the destination, so nothing is ever played.
//
// Caller contract:
// - The frame callback receives a SHARED, reused buffer: read it synchronously, never retain it.
// - If the caller itself calls stop() while start() is pending, start() resolves 'unsupported';
//   the caller must ignore that result.

export type ListenResult = 'ok' | 'denied' | 'no-mic' | 'unsupported';

export interface AudioListener {
  start(): Promise<ListenResult>;
  stop(): void;
  onFrame(fn: (freq: Uint8Array, sampleRate: number) => void): void;
  /** Called once when the mic track ends (unplugged / revoked) while running. */
  onEnded(fn: () => void): void;
}

// Byte-scale window: a bin reads 0 below ANALYSER_MIN_DB. Chosen so ordinary room noise sits under the
// tracker's gate; may need tuning with a real microphone.
export const ANALYSER_MIN_DB = -85;
export const ANALYSER_MAX_DB = -25;

const POLL_MS = 33;
const RESUME_TIMEOUT_MS = 3000;

type AudioCtxCtor = new () => AudioContext;

function getCtor(): AudioCtxCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { AudioContext?: AudioCtxCtor; webkitAudioContext?: AudioCtxCtor };
  return w.AudioContext ?? w.webkitAudioContext;
}

export function listenResultForError(name: string): ListenResult {
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-mic';
  return 'unsupported';
}

/** Resume, but never wait forever (a never-settling resume must not hang start()). */
function resumeWithTimeout(c: AudioContext): Promise<void> {
  return new Promise<void>((resolve) => {
    const t = setTimeout(resolve, RESUME_TIMEOUT_MS);
    c.resume().then(
      () => {
        clearTimeout(t);
        resolve();
      },
      () => {
        clearTimeout(t);
        resolve();
      },
    );
  });
}

export function createAudioListener(): AudioListener | null {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null;
  const Ctor = getCtor();
  if (!Ctor) return null;

  let ctx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let worker: Worker | null = null;
  let frameFn: ((freq: Uint8Array, sampleRate: number) => void) | null = null;
  let endedFn: (() => void) | null = null;
  let starting: Promise<ListenResult> | null = null;
  let running = false;
  let generation = 0; // bumped by stop() so an in-flight start() can notice and clean up

  const stopPolling = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    if (worker) {
      try {
        worker.onmessage = null;
        worker.terminate();
      } catch {
        /* already gone */
      }
      worker = null;
    }
  };

  const teardown = () => {
    stopPolling();
    try {
      stream?.getTracks().forEach((t) => {
        t.onended = null;
        t.stop();
      });
    } catch {
      /* already stopped */
    }
    stream = null;
    const c = ctx;
    ctx = null;
    running = false;
    if (c) {
      try {
        c.onstatechange = null;
        void c.close().catch(() => {});
      } catch {
        /* already closed */
      }
    }
  };

  // setInterval is throttled to ~1 Hz in hidden/covered windows; a worker's timer is not.
  const startPolling = (poll: () => void) => {
    try {
      const url = URL.createObjectURL(
        new Blob(['setInterval(()=>postMessage(0),' + POLL_MS + ')'], { type: 'text/javascript' }),
      );
      try {
        const w = new Worker(url);
        w.onmessage = poll;
        worker = w;
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      worker = null; // CSP etc.: fall back to the plain interval
    }
    if (!worker) timer = setInterval(poll, POLL_MS);
  };

  const doStart = async (): Promise<ListenResult> => {
    const gen = generation;
    try {
      ctx = new Ctor(); // created here, inside the tap-called start()
      const c = ctx;
      await resumeWithTimeout(c);
      if (gen !== generation) {
        teardown(); // stop() ran during resume: no late permission prompt
        return 'unsupported';
      }
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      stream = s;
      if (gen !== generation) {
        teardown();
        return 'unsupported';
      }
      // getUserMedia can drop the context to suspended/interrupted (iOS/Safari): best-effort resume.
      try {
        await c.resume();
      } catch {
        /* best effort */
      }
      if (gen !== generation) {
        teardown();
        return 'unsupported';
      }
      c.onstatechange = () => {
        const st = c.state as string;
        if (running && (st === 'suspended' || st === 'interrupted')) void c.resume().catch(() => {});
      };
      const analyser = c.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.4;
      analyser.minDecibels = ANALYSER_MIN_DB;
      analyser.maxDecibels = ANALYSER_MAX_DB;
      c.createMediaStreamSource(s).connect(analyser); // deliberately NOT connected to c.destination
      const buf = new Uint8Array(analyser.frequencyBinCount);
      s.getAudioTracks().forEach((t) => {
        t.onended = () => {
          if (!running || gen !== generation) return;
          teardown();
          try {
            endedFn?.();
          } catch {
            /* callback errors are not ours */
          }
        };
      });
      startPolling(() => {
        try {
          analyser.getByteFrequencyData(buf);
          frameFn?.(buf, c.sampleRate);
        } catch {
          /* nothing may kill the loop */
        }
      });
      running = true;
      return 'ok';
    } catch (e) {
      teardown();
      return listenResultForError((e as { name?: string } | null)?.name ?? '');
    }
  };

  return {
    start() {
      if (running) return Promise.resolve('ok');
      if (starting) return starting;
      starting = doStart().finally(() => {
        starting = null;
      });
      return starting;
    },
    stop() {
      generation++;
      teardown();
    },
    onFrame(fn) {
      frameFn = fn;
    },
    onEnded(fn) {
      endedFn = fn;
    },
  };
}
