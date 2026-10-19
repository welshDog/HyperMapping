import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { beatTargets, carryToHeirs, lookHandovers, reconcileLooks, shuffleTargets, withLookSettings, type LookStates } from '../generator/looks';
import { lookRenderSize } from '../generator/budget';
import { createLookPool, type LookPool } from '../generator/pool';
import { loadGeneratorState, saveGeneratorState } from '../generator/remember';
import { newLookSettings as freshLookSettings, settingsFromState, type LookSettings } from '../generator/settings';
import { randomizeState, type GeneratorState } from '../generator/shuffle';
import { createGeneratorSource } from '../generator/source';
import type { Renderer } from '../renderer';
import type { KeyValueStore } from '../setups/setups';
import type { Surface } from '../surfaces/types';

interface Args {
  renderer: Renderer | null;
  store: KeyValueStore | null;
  channelRef: MutableRefObject<BroadcastChannel | null>;
  surfacesRef: MutableRefObject<Surface[]>;
  /** The Editor's single face-list publisher (it calls `reconcile` and re-applies sources). */
  publish: (list: Surface[]) => void;
  /** The Editor's "work out what every face shows" step. */
  applySourcesRef: MutableRefObject<() => void>;
}

const sameKeys = (a: readonly string[] | null, b: readonly string[]) =>
  a !== null && a.length === b.length && a.every((k, i) => k === b[i]);

/**
 * The Editor's live looks: one runtime `GeneratorState` per look-owning face (keyed by its id), one
 * generator source per look (the pool), the shuffle timer, beat reactions and the `looks` channel message.
 * Faces sharing a look resolve to their owner, so they move with it. DOM / React: no unit tests (the pure
 * decisions live in generator/looks.ts and are tested there).
 *
 * The returned `pool` records the owners passed to `setActive` (the Editor gives it the visible looks),
 * so shuffle and beats only touch looks some face is actually showing.
 */
export function useLooks({ renderer, store, channelRef, surfacesRef, publish, applySourcesRef }: Args) {
  // A restored layout (autosave) can already have look faces: they get their states at once.
  const [initialLooks] = useState<LookStates>(() => reconcileLooks({}, surfacesRef.current, Date.now()));
  const looksRef = useRef<LookStates>(initialLooks);
  const lastListRef = useRef<Surface[]>(surfacesRef.current); // the face list the looks were last reconciled with
  const [looks, setLooks] = useState<LookStates>(initialLooks);
  const [available, setAvailable] = useState(true);
  const visibleRef = useRef<ReadonlySet<string>>(new Set());
  const rendererRef = useRef(renderer);
  rendererRef.current = renderer;
  const publishRef = useRef(publish);
  publishRef.current = publish;
  const storeRef = useRef(store);
  storeRef.current = store;

  const [pool] = useState<LookPool>(() => {
    const inner = createLookPool(createGeneratorSource);
    return {
      get available() {
        return inner.available;
      },
      sync: (owners) => inner.sync(owners),
      rekey: (from, to) => inner.rekey(from, to),
      hasSource: (owner) => inner.hasSource(owner),
      setState: (owner, state) => inner.setState(owner, state),
      setActive: (owners) => {
        visibleRef.current = owners;
        const { w, h } = lookRenderSize(owners.size); // fewer pixels per look when 3-4 are showing
        inner.setSize(w, h); // before setActive, so a look switched on draws its first frame at the final size
        inner.setActive(owners);
      },
      setSize: (w, h) => inner.setSize(w, h),
      setAudio: (levels) => inner.setAudio(levels),
      video: (owner) => inner.video(owner),
      ensurePlaying: () => inner.ensurePlaying(),
      dispose: () => inner.dispose(),
    };
  });

  const syncedRef = useRef<string[] | null>(null); // owner ids of the last pool.sync (null: sync again)
  const sentRef = useRef(new Map<string, GeneratorState>()); // the state the pool holds, by owner

  /**
   * Bring the pool in line with `looksRef`. `sync` only runs when the set of owners changed (a factory that
   * fails would otherwise be retried on every pin-drag move); states are only pushed when they changed.
   * No generator sources exist while there is no renderer.
   */
  const syncPool = useCallback(() => {
    const owners = rendererRef.current ? Object.keys(looksRef.current) : [];
    if (!sameKeys(syncedRef.current, owners)) {
      pool.sync(owners);
      syncedRef.current = owners;
      for (const id of [...sentRef.current.keys()]) if (!owners.includes(id)) sentRef.current.delete(id);
      setAvailable(pool.available);
    }
    for (const id of owners) {
      const state = looksRef.current[id];
      if (sentRef.current.get(id) !== state) {
        pool.setState(id, state);
        sentRef.current.set(id, state);
      }
    }
  }, [pool]);

  /** Tell the Output window(s) and simulator every live look's state. */
  const broadcast = useCallback(() => {
    channelRef.current?.postMessage({ type: 'looks', states: looksRef.current });
  }, [channelRef]);

  /** Called by the Editor's `publish` for every face-list change. Unchanged look settings keep their state. */
  const reconcile = useCallback(
    (list: Surface[]) => {
      // A sharer that took over a look (its owner deleted or switched away) keeps that look's running
      // state AND its generator source, so neither it nor the other sharers lose their picture.
      const handovers = lookHandovers(lastListRef.current, list);
      lastListRef.current = list;
      const next = carryToHeirs(looksRef.current, reconcileLooks(looksRef.current, list, Date.now()), handovers);
      const changed = next !== looksRef.current;
      looksRef.current = next;
      for (const { from, to } of handovers) {
        pool.rekey(from, to); // before syncPool's sync, which then keeps it (syncPool pushes `to`'s state)
      }
      syncPool();
      if (changed) {
        setLooks(next);
        broadcast();
      }
    },
    [pool, syncPool, broadcast],
  );

  /** The single place one look changes: state, pool, the owner face's saved settings, the channel. */
  const updateLook = useCallback(
    (ownerId: string, given: GeneratorState) => {
      if (!Object.hasOwn(looksRef.current, ownerId)) return; // that face no longer owns a look
      // A live look is always on (a face leaves its look by changing source); an "off" state would freeze it.
      const next = given.on ? given : { ...given, on: true };
      // Stored BEFORE publishing: reconcile then sees matching settings and keeps this very state
      // (its cross-fade and time anchor), instead of rebuilding it from the face.
      looksRef.current = { ...looksRef.current, [ownerId]: next };
      setLooks(looksRef.current);
      syncPool();
      if (storeRef.current) saveGeneratorState(storeRef.current, next);
      const list = withLookSettings(surfacesRef.current, ownerId, next);
      if (list !== surfacesRef.current) publishRef.current(list); // e.g. a cross-fade-only change saves nothing new
      broadcast();
      applySourcesRef.current();
    },
    [syncPool, broadcast, surfacesRef, applySourcesRef],
  );

  /** A beat while listening with "Big beat starts a new look" ticked: each visible look past its own throttle. */
  const beatRandomize = useCallback(
    (now: number) => {
      for (const id of beatTargets(looksRef.current, visibleRef.current, now)) {
        updateLook(id, randomizeState(looksRef.current[id], now, Math.random));
      }
    },
    [updateLook],
  );

  // One timer for every look: a visible look whose auto-shuffle time has come gets a new look.
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      for (const owner of shuffleTargets(looksRef.current, visibleRef.current, now)) {
        updateLook(owner, randomizeState(looksRef.current[owner], now, Math.random));
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [updateLook]);

  /** Settings for a face starting its own look: the remembered style pick, shuffle and speed, a fresh random look. */
  const newLookSettings = useCallback((): LookSettings => {
    const remembered = settingsFromState(loadGeneratorState(storeRef.current, Date.now(), Math.random));
    return freshLookSettings(Math.random, remembered);
  }, []);

  // Generator sources live while there is a renderer (none before it exists or if it failed).
  useEffect(() => {
    syncedRef.current = null; // force a real sync for the new renderer
    syncPool();
    applySourcesRef.current();
  }, [renderer, syncPool, applySourcesRef]);

  useEffect(() => {
    return () => {
      pool.dispose();
      syncedRef.current = null;
      sentRef.current.clear();
    };
  }, [pool]);

  return { looks, looksRef, pool, available, reconcile, updateLook, beatRandomize, newLookSettings, broadcast };
}
