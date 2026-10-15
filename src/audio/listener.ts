// Microphone listener (DOM / Web Audio only; no unit test because tests run in Node).
// The analyser is never connected to the destination, so nothing is ever played.

export type ListenResult = 'ok' | 'denied' | 'no-mic' | 'unsupported';

export interface AudioListener {
  start(): Promise<ListenResult>;
  stop(): void;
  onFrame(fn: (freq: Uint8Array, sampleRate: number) => void): void;
}

type AudioCtxCtor = new () => AudioContext;

function getCtor(): AudioCtxCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { AudioContext?: AudioCtxCtor; webkitAudioContext?: AudioCtxCtor };
  return w.AudioContext ?? w.webkitAudioContext;
}

function mapError(e: unknown): ListenResult {
  const name = (e as { name?: string } | null)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'denied';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'no-mic';
  return 'unsupported';
}

export function createAudioListener(): AudioListener | null {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null;
  const Ctor = getCtor();
  if (!Ctor) return null;

  let ctx: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let frameFn: ((freq: Uint8Array, sampleRate: number) => void) | null = null;
  let starting: Promise<ListenResult> | null = null;
  let running = false;
  let generation = 0; // bumped by stop() so an in-flight start() can notice and clean up

  const teardown = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    try {
      stream?.getTracks().forEach((t) => t.stop());
    } catch {
      /* already stopped */
    }
    stream = null;
    const c = ctx;
    ctx = null;
    running = false;
    try {
      void c?.close().catch(() => {});
    } catch {
      /* already closed */
    }
  };

  const doStart = async (): Promise<ListenResult> => {
    const gen = generation;
    try {
      ctx = new Ctor(); // created here, inside the tap-called start()
      await ctx.resume();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (gen !== generation) {
        teardown(); // stop() ran while we were waiting for permission
        return 'unsupported';
      }
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.4;
      ctx.createMediaStreamSource(stream).connect(analyser); // deliberately NOT connected to ctx.destination
      const buf = new Uint8Array(analyser.frequencyBinCount);
      const c = ctx;
      timer = setInterval(() => {
        analyser.getByteFrequencyData(buf);
        try {
          frameFn?.(buf, c.sampleRate);
        } catch {
          /* a throwing callback must not kill the loop */
        }
      }, 33);
      running = true;
      return 'ok';
    } catch (e) {
      teardown();
      return mapError(e);
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
  };
}
