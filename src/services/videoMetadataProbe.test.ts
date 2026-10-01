import { describe, expect, it, vi } from 'vitest';

import {
  probeVideoFile,
  VideoProbeError,
  type VideoElementLike,
  type VideoProbeDeps,
} from './videoMetadataProbe';

type Behavior = 'metadata' | 'error' | 'silent';

interface FakeElement extends VideoElementLike {
  readonly listeners: Map<string, Set<() => void>>;
  loadCalls: number;
  removedAttributes: string[];
  emit(type: string): void;
}

function fakeElement(
  behavior: Behavior,
  info: { duration?: number; width?: number; height?: number } = {},
): FakeElement {
  const listeners = new Map<string, Set<() => void>>();
  const element: FakeElement = {
    src: '',
    preload: '',
    muted: false,
    duration: info.duration ?? 0,
    videoWidth: info.width ?? 0,
    videoHeight: info.height ?? 0,
    loadCalls: 0,
    removedAttributes: [],
    listeners,
    addEventListener(type, listener) {
      const set = listeners.get(type) ?? new Set();
      set.add(listener);
      listeners.set(type, set);
    },
    removeEventListener(type, listener) {
      listeners.get(type)?.delete(listener);
    },
    removeAttribute(name) {
      element.removedAttributes.push(name);
    },
    emit(type) {
      for (const listener of [...(listeners.get(type) ?? [])]) listener();
    },
    load() {
      element.loadCalls += 1;
      if (behavior === 'metadata') element.emit('loadedmetadata');
      if (behavior === 'error') element.emit('error');
    },
  };
  return element;
}

function fakeDeps(element: FakeElement) {
  const revoked: string[] = [];
  let timeoutHandler: (() => void) | null = null;
  let timeoutMs = -1;
  const deps: VideoProbeDeps = {
    createVideo: () => element,
    createObjectUrl: () => 'blob:probe',
    revokeObjectUrl: (url) => revoked.push(url),
    setTimeout: (handler, ms) => {
      timeoutHandler = handler;
      timeoutMs = ms;
      return 1;
    },
    clearTimeout: () => undefined,
  };
  return {
    deps,
    revoked,
    fireTimeout: () => timeoutHandler?.(),
    timeoutMs: () => timeoutMs,
  };
}

const file = new File([new Uint8Array(2048)], 'clip.mp4', { type: 'video/mp4' });

describe('probeVideoFile', () => {
  it('resolves the duration and intrinsic size from the file metadata', async () => {
    const element = fakeElement('metadata', { duration: 42.5, width: 1920, height: 1080 });
    const harness = fakeDeps(element);

    const result = await probeVideoFile(file, harness.deps, 5_000);

    expect(result).toEqual({ durationSeconds: 42.5, width: 1920, height: 1080 });
    // The element is detached and the object URL released.
    expect(element.removedAttributes).toContain('src');
    expect(harness.revoked).toEqual(['blob:probe']);
  });

  it('rejects with a truthful message when the browser cannot decode the file', async () => {
    const element = fakeElement('error');
    const harness = fakeDeps(element);

    await expect(probeVideoFile(file, harness.deps, 5_000)).rejects.toBeInstanceOf(VideoProbeError);
    await expect(probeVideoFile(file, harness.deps, 5_000)).rejects.toThrow(/codec|container/i);
    expect(harness.revoked).toContain('blob:probe');
  });

  it('rejects on the bounded timeout instead of hanging, and says to enter it manually', async () => {
    const element = fakeElement('silent');
    const harness = fakeDeps(element);

    const pending = probeVideoFile(file, harness.deps, 50);
    expect(harness.timeoutMs()).toBe(50);
    harness.fireTimeout();

    await expect(pending).rejects.toThrow(/manual/i);
    expect(element.removedAttributes).toContain('src');
  });

  it('rejects a zero/NaN duration rather than publishing a bogus value', async () => {
    const element = fakeElement('metadata', { duration: 0 });
    const harness = fakeDeps(element);

    await expect(probeVideoFile(file, harness.deps, 5_000)).rejects.toThrow(/duration/i);
  });

  it('settles once: a late metadata event cannot revive a timed-out probe', async () => {
    const element = fakeElement('silent');
    const harness = fakeDeps(element);
    const onSettle = vi.fn();

    const pending = probeVideoFile(file, harness.deps, 50).then(onSettle, onSettle);
    harness.fireTimeout();
    element.duration = 30;
    element.emit('loadedmetadata');
    await pending;

    expect(onSettle).toHaveBeenCalledTimes(1);
  });
});
