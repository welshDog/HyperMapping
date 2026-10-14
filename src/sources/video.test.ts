import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createVideoFromBlob } from './video';

/** Just enough of an HTMLVideoElement for the loader, built on Node's EventTarget. */
class FakeVideo extends EventTarget {
  muted = false;
  loop = false;
  playsInline = false;
  preload = '';
  src = '';
  paused = true;
  style = { cssText: '' };
  attrs = new Map<string, string>();
  removed = 0;
  playImpl: () => Promise<void> = () => Promise.resolve();
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  removeAttribute(k: string) {
    this.attrs.delete(k);
    if (k === 'src') this.src = '';
  }
  play() {
    this.paused = false;
    return this.playImpl().catch((e) => {
      this.paused = true;
      throw e;
    });
  }
  pause() {
    this.paused = true;
  }
  load() {}
  remove() {
    this.removed++;
    body.children.delete(this);
  }
  fire(type: string) {
    this.dispatchEvent(new Event(type));
  }
}

const body = {
  children: new Set<unknown>(),
  appendChild(el: unknown) {
    this.children.add(el);
    return el;
  },
};

let video: FakeVideo;
let revoked: string[];

beforeEach(() => {
  video = new FakeVideo();
  revoked = [];
  body.children.clear();
  vi.stubGlobal('document', { createElement: () => video, body });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fake');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((u: string) => void revoked.push(u));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const blob = new Blob(['x'], { type: 'video/mp4' });

describe('createVideoFromBlob', () => {
  it('resolves on loadeddata, playing, and attached hidden to the DOM', async () => {
    const p = createVideoFromBlob(blob);
    expect(video.src).toBe('blob:fake');
    expect(body.children.has(video)).toBe(true);
    expect(video.style.cssText).toContain('opacity:0');
    expect(video.style.cssText).not.toContain('display:none');
    video.fire('loadeddata');
    const h = await p;
    expect(h.video).toBe(video);
    expect(h.playing).toBe(true);
  });

  it('resolves on a playing event even if loadeddata never fires (iOS)', async () => {
    const p = createVideoFromBlob(blob);
    video.fire('playing');
    const h = await p;
    expect(h.playing).toBe(true);
  });

  it('reports playing=false when autoplay is refused', async () => {
    video.playImpl = () => Promise.reject(new Error('NotAllowedError'));
    const p = createVideoFromBlob(blob);
    video.fire('loadeddata');
    const h = await p;
    expect(h.playing).toBe(false);
  });

  it('rejects on a decode error and disposes', async () => {
    const p = createVideoFromBlob(blob);
    video.fire('error');
    await expect(p).rejects.toThrow('This browser could not decode that video');
    expect(revoked).toEqual(['blob:fake']);
    expect(body.children.has(video)).toBe(false);
  });

  it('rejects after the timeout and disposes', async () => {
    vi.useFakeTimers();
    video.playImpl = () => new Promise(() => {}); // never settles
    const p = createVideoFromBlob(blob, 1000);
    const result = p.then(
      () => 'resolved',
      (e: Error) => e.message,
    );
    await vi.advanceTimersByTimeAsync(999);
    video.fire('nothing');
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toBe('Timed out loading that video');
    expect(revoked).toEqual(['blob:fake']);
    expect(body.children.has(video)).toBe(false);
    // Listeners are gone: a late event changes nothing and does not throw.
    video.fire('loadeddata');
  });

  it('defaults the timeout to 10 s', async () => {
    vi.useFakeTimers();
    const p = createVideoFromBlob(blob);
    let settled = false;
    p.catch(() => {}).finally(() => (settled = true));
    await vi.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(p).rejects.toThrow('Timed out loading that video');
  });

  it('dispose removes the element and revokes the URL', async () => {
    const p = createVideoFromBlob(blob);
    video.fire('loadeddata');
    const h = await p;
    h.dispose();
    expect(video.paused).toBe(true);
    expect(revoked).toEqual(['blob:fake']);
    expect(body.children.has(video)).toBe(false);
  });
});
