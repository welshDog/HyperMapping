import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { bandLevels } from '../audio/bands';
import { createBeatDetector } from '../audio/beat';
import { createAudioListener, type AudioListener } from '../audio/listener';
import { createLevelThrottle, scaleBySensitivity } from '../audio/reactor-logic';
import { loadAudioSettings, masked, parseAudioSettings, saveAudioSettings, type AudioSettings } from '../audio/settings';
import { createLevelTracker } from '../audio/tracker';
import type { LookPool } from '../generator/pool';
import { getBrowserStore } from '../setups/browser-store';

export type AudioStatus = 'off' | 'starting' | 'listening' | 'denied' | 'no-mic' | 'unsupported';
export interface MeterLevels {
  bass: number;
  treble: number;
  volume: number;
}

const ZERO: MeterLevels = { bass: 0, treble: 0, volume: 0 };

interface Args {
  channelRef: MutableRefObject<BroadcastChannel | null>;
  /** The Editor's own looks: a channel never delivers to its sender, so every look is fed directly. */
  poolRef: MutableRefObject<LookPool | null>;
  /** A beat while listening with "Big beat starts a new look" ticked (each look applies its own throttle). */
  onBeat: (now: number) => void;
}

/**
 * The Editor's microphone engine. The listener's frame callback (a worker-driven ~33 ms tick) is the ONLY
 * caller of the tracker and the beat detector, because their time constants are per call. Everything that
 * callback reads lives in refs, never in React state. No unit tests for this file (DOM / React, Node test
 * env); the pure decisions it uses are tested in audio/reactor-logic.test.ts.
 */
export function useAudioReactor({ channelRef, poolRef, onBeat }: Args) {
  const [store] = useState(() => getBrowserStore());
  const [settings, setSettingsState] = useState<AudioSettings>(() => loadAudioSettings(store));
  const [status, setStatus] = useState<AudioStatus>('off');
  const [levels, setLevels] = useState<MeterLevels>(ZERO);
  // Listening support is a cheap capability check (it creates no AudioContext and asks for no permission).
  const [supported] = useState(() => createAudioListener() !== null);

  const settingsRef = useRef(settings);
  const onBeatRef = useRef(onBeat);
  onBeatRef.current = onBeat;
  const listenerRef = useRef<AudioListener | null>(null);
  const listeningRef = useRef(false);
  const startingRef = useRef(false); // a start() is in flight and has not settled yet
  const epochRef = useRef(0); // bumped by stop / unmount: a start() from an older epoch is ignored
  const trackerRef = useRef(createLevelTracker());
  const detectorRef = useRef(createBeatDetector());
  const throttleRef = useRef(createLevelThrottle());

  /** The one place levels go out: the Output window(s) over the channel and every look of the Editor's own. */
  const sendLevels = useCallback(
    (bass: number, treble: number, vol: number) => {
      channelRef.current?.postMessage({ type: 'audio', bass, treble, vol });
      poolRef.current?.setAudio({ bass, treble, vol });
    },
    [channelRef, poolRef],
  );
  const postZeros = useCallback(() => sendLevels(0, 0, 0), [sendLevels]);

  /** Everything that must happen when listening ends, whatever ended it. */
  const settleOff = useCallback(
    (publishUi: boolean) => {
      listeningRef.current = false;
      trackerRef.current.reset();
      detectorRef.current.reset();
      throttleRef.current.reset();
      postZeros();
      if (publishUi) {
        setLevels(ZERO);
        setStatus('off');
      }
    },
    [postZeros],
  );

  /** The frame callback. The `freq` buffer is shared and reused: read it here, never keep it. */
  const onFrame = useCallback(
    (freq: Uint8Array, sampleRate: number) => {
      if (!listeningRef.current) return;
      const now = Date.now();
      const s = settingsRef.current;
      const base = trackerRef.current.update(bandLevels(freq, sampleRate), 1); // sensitivity 1: never saturates
      const beat = detectorRef.current.update(base.bass, now); // beats are judged on the unscaled bass
      const scaled = scaleBySensitivity(base, s.sensitivity);
      const m = masked(scaled, s);
      sendLevels(m.bass, m.treble, m.vol);
      if (throttleRef.current.due(now)) {
        setLevels({ bass: scaled.bass, treble: scaled.treble, volume: scaled.volume });
      }
      if (beat && s.beatLook) onBeatRef.current(now); // listening is already true here
    },
    [sendLevels],
  );

  const stop = useCallback(() => {
    epochRef.current++; // any start() still in flight is now stale
    listenerRef.current?.stop();
    settleOff(true);
  }, [settleOff]);

  /** Call only from a tap handler: the microphone prompt and AudioContext need a user gesture. */
  const start = useCallback(async () => {
    if (listeningRef.current || startingRef.current) return; // already listening, or the last start() has not settled
    if (!listenerRef.current) {
      const l = createAudioListener();
      if (!l) {
        setStatus('unsupported');
        return;
      }
      l.onFrame(onFrame);
      l.onEnded(() => {
        // Mic unplugged or revoked while running: the listener already released everything.
        if (!listeningRef.current) return;
        settleOff(true);
      });
      listenerRef.current = l;
    }
    const listener = listenerRef.current;
    const myEpoch = epochRef.current;
    startingRef.current = true;
    setStatus('starting');
    let result: Awaited<ReturnType<AudioListener['start']>>;
    try {
      result = await listener.start();
    } finally {
      startingRef.current = false;
    }
    if (myEpoch !== epochRef.current) {
      if (result === 'ok') listener.stop(); // cannot normally happen; never leave a mic open after our own stop
      return; // the user pressed Stop (or we unmounted) meanwhile: ignore this result
    }
    if (result === 'ok') {
      trackerRef.current.reset();
      detectorRef.current.reset();
      throttleRef.current.reset();
      listeningRef.current = true;
      setStatus('listening');
    } else {
      setStatus(result); // 'denied' | 'no-mic' | 'unsupported'
    }
  }, [onFrame, settleOff]);

  const setSettings = useCallback(
    (next: AudioSettings) => {
      const clean = parseAudioSettings(next);
      settingsRef.current = clean;
      setSettingsState(clean);
      saveAudioSettings(store, clean);
    },
    [store],
  );

  // Unmount releases everything. Declared by the Editor BEFORE its channel effect, so this cleanup runs
  // while the channel is still open and the final zero message really goes out.
  useEffect(() => {
    return () => {
      epochRef.current++;
      listenerRef.current?.stop();
      listenerRef.current = null;
      settleOff(false); // no React state updates during unmount
    };
  }, [settleOff]);

  return { status, levels, settings, setSettings, start, stop, supported };
}
