import { describe, expect, it } from 'vitest';

import { runBounded } from './queue';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('runBounded', () => {
  it('returns an empty result for an empty input without invoking the worker', async () => {
    let calls = 0;
    const results = await runBounded([], 3, async () => {
      calls += 1;
    });
    expect(results).toEqual([]);
    expect(calls).toBe(0);
  });

  it('preserves input order and isolates a rejected worker', async () => {
    const results = await runBounded([1, 2, 3, 4], 2, async (value) => {
      if (value === 3) throw new Error('boom');
      return value * 2;
    });
    expect(results.map((result) => (result.ok ? result.value : 'error'))).toEqual([
      2,
      4,
      'error',
      8,
    ]);
  });

  it('never exceeds the concurrency limit', async () => {
    const gates = Array.from({ length: 6 }, () => deferred<void>());
    let active = 0;
    let maxActive = 0;

    const run = runBounded([0, 1, 2, 3, 4, 5], 2, async (index) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gates[index].promise;
      active -= 1;
      return index;
    });

    // Give the pool a chance to saturate, then release every gate.
    await Promise.resolve();
    gates.forEach((gate) => gate.resolve());
    const results = await run;

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results.every((result) => result.ok)).toBe(true);
  });

  it('caps concurrency at the number of items', async () => {
    let active = 0;
    let maxActive = 0;
    await runBounded([1, 2], 10, async (value) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return value;
    });
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});
