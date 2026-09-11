import { describe, expect, it } from 'vitest';

import { loadCatalog } from './catalogRepository';
import { createContentCache } from './cache';
import { createRecordingReader, makeSearchHit } from '../test/fixtures/qdn';
import {
  TEST_BLOG_ID,
  TEST_MANIFEST_FIXTURE,
  TEST_PARTITION_FIXTURE,
  TEST_PUBLISHER,
  TEST_VIDEO_ID,
  makeCatalogEntry,
} from '../test/fixtures/content';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const MANIFEST_ID = 'saw_cat_manifest';

function makeVideoPartition(identifier = 'saw_cat_vid_p001') {
  return {
    schemaVersion: 1,
    kind: 'catalog-partition',
    type: 'video',
    partition: Number(identifier.slice(-3)),
    compiledAt: 1_700_000_500_000,
    entries: [makeCatalogEntry('video', TEST_VIDEO_ID)],
  };
}

function makePostPartition(entries: unknown[], identifier = 'saw_cat_post_p001') {
  return {
    schemaVersion: 1,
    kind: 'catalog-partition',
    type: 'blog-post',
    partition: Number(identifier.slice(-3)),
    compiledAt: 1_700_000_500_000,
    entries,
  };
}

/** Fake node backed by an identifier -> payload map. */
function nodeReader(resources: Record<string, unknown>) {
  return createRecordingReader(
    (request) => {
      const identifier = request.identifier;
      if (typeof identifier === 'string' && identifier in resources) {
        return [makeSearchHit('DOCUMENT', TEST_PUBLISHER, identifier)];
      }
      if (request.defaultResource) return [makeSearchHit('DOCUMENT', TEST_PUBLISHER, null)];
      return [];
    },
    (ref) => {
      const value = resources[ref.identifier ?? ''];
      if (value === undefined) throw new Error('resource not found');
      return JSON.stringify(value);
    },
  );
}

function standardResources(): Record<string, unknown> {
  return {
    [MANIFEST_ID]: clone(TEST_MANIFEST_FIXTURE),
    saw_cat_post_p001: clone(TEST_PARTITION_FIXTURE),
    saw_cat_vid_p001: makeVideoPartition(),
  };
}

const NOW = 1_700_001_000_000;

describe('loadCatalog', () => {
  it('loads a manifest, fetches each declared partition and returns validated listings', async () => {
    const reader = nodeReader(standardResources());
    const result = await loadCatalog(reader, createContentCache(), TEST_PUBLISHER, { now: NOW });

    expect(result.kind).toBe('loaded');
    if (result.kind !== 'loaded') return;
    expect(result.listings).toHaveLength(2);
    expect(result.listings.map((listing) => listing.type).sort()).toEqual(['blog-post', 'video']);
    expect(result.partial).toBe(false);
    expect(result.partitionFailures).toBe(0);
  });

  it('reports an absent manifest as missing (so the caller can fall back)', async () => {
    const reader = nodeReader({});
    const result = await loadCatalog(reader, createContentCache(), TEST_PUBLISHER, { now: NOW });
    expect(result.kind).toBe('missing');
  });

  it('treats a malformed manifest as invalid rather than empty', async () => {
    const resources = standardResources();
    resources[MANIFEST_ID] = { schemaVersion: 99, kind: 'catalog-manifest' };
    const result = await loadCatalog(nodeReader(resources), createContentCache(), TEST_PUBLISHER, {
      now: NOW,
    });
    expect(result.kind).toBe('invalid');
  });

  it('distinguishes a read failure from a missing catalog', async () => {
    const reader = createRecordingReader(
      () => {
        throw new Error('node unreachable');
      },
      () => '',
    );
    const result = await loadCatalog(reader, createContentCache(), TEST_PUBLISHER, { now: NOW });
    expect(result.kind).toBe('error');
  });

  it('stays partial when a single partition is missing, keeping the rest', async () => {
    const resources = standardResources();
    delete resources.saw_cat_vid_p001;
    const result = await loadCatalog(nodeReader(resources), createContentCache(), TEST_PUBLISHER, {
      now: NOW,
    });

    expect(result.kind).toBe('loaded');
    if (result.kind !== 'loaded') return;
    expect(result.listings).toHaveLength(1);
    expect(result.partial).toBe(true);
    expect(result.partitionFailures).toBe(1);
    expect(result.diagnostics.some((entry) => entry.code === 'catalog-partition-missing')).toBe(
      true,
    );
  });

  it('stays partial when a partition fails validation (one bad partition cannot blank the archive)', async () => {
    const resources = standardResources();
    resources.saw_cat_vid_p001 = { schemaVersion: 1, kind: 'catalog-partition', type: 'video' };
    const result = await loadCatalog(nodeReader(resources), createContentCache(), TEST_PUBLISHER, {
      now: NOW,
    });

    expect(result.kind).toBe('loaded');
    if (result.kind !== 'loaded') return;
    expect(result.listings).toHaveLength(1);
    expect(result.partial).toBe(true);
    expect(result.diagnostics.some((entry) => entry.code === 'catalog-partition-invalid')).toBe(
      true,
    );
  });

  it('reports invalid when every declared partition fails to load', async () => {
    const resources = standardResources();
    delete resources.saw_cat_post_p001;
    delete resources.saw_cat_vid_p001;
    const result = await loadCatalog(nodeReader(resources), createContentCache(), TEST_PUBLISHER, {
      now: NOW,
    });
    expect(result.kind).toBe('invalid');
    if (result.kind === 'invalid') expect(result.error.kind).toBe('partial-catalog');
  });

  it('dedupes a duplicate entry across partitions, keeping the newest', async () => {
    const manifest = clone(TEST_MANIFEST_FIXTURE) as unknown as {
      partitions: Array<Record<string, unknown>>;
    };
    manifest.partitions = [
      { ...manifest.partitions[0], identifier: 'saw_cat_post_p001' },
      { ...manifest.partitions[0], identifier: 'saw_cat_post_p002' },
    ];
    const older = makeCatalogEntry('blog-post', TEST_BLOG_ID, { title: 'Older', updatedAt: 100 });
    const newer = makeCatalogEntry('blog-post', TEST_BLOG_ID, { title: 'Newer', updatedAt: 200 });

    const resources = {
      [MANIFEST_ID]: manifest,
      saw_cat_post_p001: makePostPartition([older]),
      saw_cat_post_p002: makePostPartition([newer], 'saw_cat_post_p002'),
    };

    const result = await loadCatalog(nodeReader(resources), createContentCache(), TEST_PUBLISHER, {
      now: NOW,
    });
    expect(result.kind).toBe('loaded');
    if (result.kind !== 'loaded') return;
    expect(result.listings).toHaveLength(1);
    expect(result.listings[0].title).toBe('Newer');
  });

  it('serves a later read from the success cache without re-querying the node', async () => {
    const cache = createContentCache({ now: () => NOW });
    const first = await loadCatalog(nodeReader(standardResources()), cache, TEST_PUBLISHER, {
      now: NOW,
    });
    expect(first.kind).toBe('loaded');

    const offline = createRecordingReader(
      () => {
        throw new Error('offline');
      },
      () => {
        throw new Error('offline');
      },
    );
    const second = await loadCatalog(offline, cache, TEST_PUBLISHER, { now: NOW });
    expect(second.kind).toBe('loaded');
    expect(offline.searches).toHaveLength(0);
    expect(offline.fetches).toHaveLength(0);
  });

  it('never permanently caches a failure: a later success still loads', async () => {
    const cache = createContentCache({ now: () => NOW });
    const broken = createRecordingReader(
      (request) =>
        typeof request.identifier === 'string' && request.identifier in standardResources()
          ? [makeSearchHit('DOCUMENT', TEST_PUBLISHER, request.identifier)]
          : [],
      () => {
        throw new Error('transient failure');
      },
    );

    const failed = await loadCatalog(broken, cache, TEST_PUBLISHER, { now: NOW });
    expect(failed.kind).toBe('error');

    const ok = await loadCatalog(nodeReader(standardResources()), cache, TEST_PUBLISHER, {
      now: NOW,
    });
    expect(ok.kind).toBe('loaded');
  });
});
