import { describe, expect, it } from 'vitest';

import { discoverArchive } from './fallbackDiscovery';
import { createRecordingReader, makeSearchHit } from '../test/fixtures/qdn';

const PUBLISHER = 'Shadow Archives';

describe('discoverArchive', () => {
  it('uses prefix discovery with mode ALL and explicit pagination bounds', async () => {
    const reader = createRecordingReader(
      (request) => {
        if (request.offset === 0) {
          return [
            makeSearchHit('DOCUMENT', PUBLISHER, 'saw_post_aaa000000001'),
            makeSearchHit('DOCUMENT', PUBLISHER, 'saw_post_aaa000000002'),
          ];
        }
        return [makeSearchHit('DOCUMENT', PUBLISHER, 'saw_post_aaa000000003')];
      },
      () => '',
    );

    const result = await discoverArchive(reader, PUBLISHER, {
      kinds: ['blog-post'],
      pageSize: 2,
      maxPages: 5,
    });

    expect(result.listings).toHaveLength(3);
    expect(result.pagesFetched).toBe(2);
    expect(result.partial).toBe(true);

    expect(reader.searches).toHaveLength(2);
    expect(reader.searches[0]).toMatchObject({
      service: 'DOCUMENT',
      name: PUBLISHER,
      identifier: 'saw_post_',
      prefix: true,
      exactMatchNames: true,
      mode: 'ALL',
      limit: 2,
      offset: 0,
    });
    expect(reader.searches[1]).toMatchObject({ offset: 2, limit: 2 });
    // Never `limit: 0` (which Core would treat as unbounded).
    for (const request of reader.searches) {
      expect(request.limit).toBeGreaterThan(0);
    }
  });

  it('stops at maxPages and marks the result partial rather than unbounded', async () => {
    const reader = createRecordingReader(
      () => [
        makeSearchHit('DOCUMENT', PUBLISHER, 'saw_post_aaa000000001'),
        makeSearchHit('DOCUMENT', PUBLISHER, 'saw_post_aaa000000002'),
      ],
      () => '',
    );

    const result = await discoverArchive(reader, PUBLISHER, {
      kinds: ['blog-post'],
      pageSize: 2,
      maxPages: 3,
    });

    expect(reader.searches).toHaveLength(3);
    expect(result.pagesFetched).toBe(3);
    expect(result.partial).toBe(true);
    expect(result.diagnostics.some((entry) => entry.code === 'fallback-partial')).toBe(true);
  });

  it('filters out hits from other publishers or services', async () => {
    const reader = createRecordingReader(
      () => [
        makeSearchHit('DOCUMENT', 'Other Publisher', 'saw_post_aaa000000001'),
        makeSearchHit('APP', PUBLISHER, 'saw_post_aaa000000002'),
        makeSearchHit('DOCUMENT', PUBLISHER, 'saw_post_aaa000000003'),
      ],
      () => '',
    );

    const result = await discoverArchive(reader, PUBLISHER, {
      kinds: ['blog-post'],
      pageSize: 10,
      maxPages: 1,
    });

    expect(result.listings.map((listing) => listing.identifier)).toEqual(['saw_post_aaa000000003']);
  });

  it('dedupes repeated identifiers and drops identifiers that are not stable ids', async () => {
    const reader = createRecordingReader(
      () => [
        makeSearchHit('DOCUMENT', PUBLISHER, 'saw_post_aaa000000001'),
        makeSearchHit('DOCUMENT', PUBLISHER, 'saw_post_aaa000000001'),
        makeSearchHit('DOCUMENT', PUBLISHER, 'saw_post_short'),
        makeSearchHit('DOCUMENT', PUBLISHER, null),
      ],
      () => '',
    );

    const result = await discoverArchive(reader, PUBLISHER, {
      kinds: ['blog-post'],
      pageSize: 10,
      maxPages: 1,
    });

    expect(result.listings).toHaveLength(1);
  });

  it('isolates a failing kind from the others', async () => {
    const reader = createRecordingReader(
      (request) => {
        if (request.identifier === 'saw_vid_') throw new Error('node unavailable');
        if (request.identifier === 'saw_post_') {
          return [makeSearchHit('DOCUMENT', PUBLISHER, 'saw_post_aaa000000001')];
        }
        return [];
      },
      () => '',
    );

    const result = await discoverArchive(reader, PUBLISHER, {
      kinds: ['blog-post', 'video'],
      pageSize: 10,
      maxPages: 1,
    });

    expect(result.listings).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
    expect(result.partial).toBe(true);
  });

  it('never claims full coverage: partial is always true', async () => {
    const reader = createRecordingReader(
      () => [],
      () => '',
    );
    const result = await discoverArchive(reader, PUBLISHER, { kinds: ['video'] });
    expect(result.partial).toBe(true);
    expect(result.listings).toHaveLength(0);
  });

  it('carries only listing metadata, never a full body', async () => {
    const reader = createRecordingReader(
      () => [
        makeSearchHit('DOCUMENT', PUBLISHER, 'saw_post_aaa000000001', {
          metadata: { title: 'T', description: 'D', tags: ['ignored'], category: 'ignored' },
        }),
      ],
      () => {
        throw new Error('fallback discovery must not fetch resource bodies');
      },
    );

    const result = await discoverArchive(reader, PUBLISHER, {
      kinds: ['blog-post'],
      pageSize: 10,
      maxPages: 1,
    });

    expect(reader.fetches).toHaveLength(0);
    expect(result.listings[0].title).toBe('T');
    // Core metadata tags/category are NOT the canonical taxonomy.
    expect(result.listings[0].tags).toEqual([]);
    expect(result.listings[0].categories).toEqual([]);
  });
});
