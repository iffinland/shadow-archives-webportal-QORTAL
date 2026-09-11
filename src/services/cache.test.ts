import { describe, expect, it } from 'vitest';

import { createContentCache, isCacheFresh } from './cache';

describe('createContentCache', () => {
  it('stores and reads back a record', async () => {
    const cache = createContentCache();
    await cache.put('k', { value: 1 }, { ttlMs: 1000, version: 1 });
    const record = await cache.get<{ value: number }>('k', 1);
    expect(record?.value).toEqual({ value: 1 });
  });

  it('treats a version mismatch as a miss (invalidation by schema)', async () => {
    const cache = createContentCache();
    await cache.put('k', { value: 1 }, { ttlMs: 1000, version: 1 });
    expect(await cache.get('k', 2)).toBeNull();
  });

  it('reports freshness from the stored expiry via an injectable clock', async () => {
    let now = 1000;
    const cache = createContentCache({ now: () => now });
    await cache.put('k', 'v', { ttlMs: 500, version: 1 });

    const fresh = await cache.get<string>('k', 1);
    expect(fresh && isCacheFresh(fresh, now)).toBe(true);

    now = 1600;
    const expired = await cache.get<string>('k', 1);
    // The record is still returned so callers can implement stale-while-revalidate.
    expect(expired && isCacheFresh(expired, now)).toBe(false);
  });

  it('deletes and clears records', async () => {
    const cache = createContentCache();
    await cache.put('a', 1, { ttlMs: 1000 });
    await cache.put('b', 2, { ttlMs: 1000 });
    await cache.delete('a');
    expect(await cache.get('a')).toBeNull();
    await cache.clear();
    expect(await cache.get('b')).toBeNull();
  });
});
