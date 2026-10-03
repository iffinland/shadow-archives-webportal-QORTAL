import { afterEach, describe, expect, it, vi } from 'vitest';

import { randomHexId } from './randomId';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('randomHexId', () => {
  it('produces a lowercase hex token of the requested length from getRandomValues', () => {
    vi.stubGlobal('crypto', {
      getRandomValues: (array: Uint8Array) => {
        array.fill(0xab);
        return array;
      },
    });

    expect(randomHexId(8)).toBe('bbbbbbbb');
    expect(randomHexId(4)).toBe('bbbb');
  });

  it('does not depend on crypto.randomUUID, which is absent in some Qortal Hub runtimes', () => {
    const source = {
      getRandomValues: (array: Uint8Array) => {
        array.fill(0x01);
        return array;
      },
    };
    expect('randomUUID' in source).toBe(false);

    vi.stubGlobal('crypto', source);

    expect(randomHexId(4)).toBe('1111');
  });

  it('fails closed when the runtime exposes no secure randomness', () => {
    vi.stubGlobal('crypto', undefined);

    expect(() => randomHexId(8)).toThrow(/randomness is unavailable/);
  });

  it('rejects a non-positive length', () => {
    expect(() => randomHexId(0)).toThrow(/positive integer/);
  });
});
