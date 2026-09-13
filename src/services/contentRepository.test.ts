import { describe, expect, it } from 'vitest';

import {
  aggregateTaxonomy,
  filterListings,
  loadArchive,
  loadEntityDetail,
  paginate,
  withDerivedAlbumCovers,
} from './contentRepository';
import { createContentCache } from './cache';
import type { CatalogListing } from '../domain';
import type { PublisherScope } from './publisher';
import { createRecordingReader, makeSearchHit } from '../test/fixtures/qdn';
import {
  TEST_ALBUM_FIXTURE,
  TEST_ALBUM_ID,
  TEST_BLOG_FIXTURE,
  TEST_BLOG_ID,
  TEST_ITEM_FIXTURE,
  TEST_ITEM_ID,
  TEST_MANIFEST_FIXTURE,
  TEST_PARTITION_FIXTURE,
  TEST_PUBLISHER,
  TEST_VIDEO_ID,
} from '../test/fixtures/content';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const SCOPED: PublisherScope = { scoped: true, name: TEST_PUBLISHER, service: 'DOCUMENT' };
const UNSCOPED: PublisherScope = { scoped: false, reason: 'no-qortal-context' };
const NOW = 1_700_001_000_000;

function makeListing(overrides: Partial<CatalogListing> = {}): CatalogListing {
  return {
    id: TEST_BLOG_ID,
    type: 'blog-post',
    service: 'DOCUMENT',
    identifier: `saw_post_${TEST_BLOG_ID}`,
    title: 'Redaction notes',
    slug: 'redaction-notes',
    excerpt: 'An excerpt.',
    createdAt: 1,
    updatedAt: 2,
    categories: ['Field Notes'],
    tags: ['Archive'],
    thumbnail: null,
    state: 'active',
    contentHash: null,
    likeCount: null,
    commentCount: null,
    countsCompiledAt: null,
    durationSeconds: null,
    width: null,
    height: null,
    albumId: null,
    partitionIdentifier: 'saw_cat_post_p001',
    ...overrides,
  };
}

function catalogResources() {
  return {
    saw_cat_manifest: clone(TEST_MANIFEST_FIXTURE),
    saw_cat_post_p001: clone(TEST_PARTITION_FIXTURE),
    saw_cat_vid_p001: {
      schemaVersion: 1,
      kind: 'catalog-partition',
      type: 'video',
      partition: 1,
      compiledAt: NOW,
      entries: [
        {
          id: TEST_VIDEO_ID,
          service: 'DOCUMENT',
          identifier: `saw_vid_${TEST_VIDEO_ID}`,
          title: 'Field footage',
          slug: 'field-footage',
          excerpt: '',
          createdAt: 1,
          updatedAt: 2,
          categories: [],
          tags: [],
          thumbnail: null,
          state: 'active',
          contentHash: null,
          likeCount: null,
          commentCount: null,
          countsCompiledAt: null,
          durationSeconds: 10,
          width: null,
          height: null,
          albumId: null,
        },
      ],
    },
  } as Record<string, unknown>;
}

function readerFor(resources: Record<string, unknown>) {
  return createRecordingReader(
    (request) => {
      if (request.prefix && typeof request.identifier === 'string') {
        const kindPrefix = request.identifier;
        return Object.keys(resources)
          .filter((key) => key.startsWith(kindPrefix.replace('saw_', 'saw_')) && key in resources)
          .filter((key) => {
            if (kindPrefix === 'saw_post_') return key.startsWith('saw_post_');
            if (kindPrefix === 'saw_vid_') return key.startsWith('saw_vid_');
            return false;
          })
          .map((key) => makeSearchHit('DOCUMENT', TEST_PUBLISHER, key));
      }
      const identifier = request.identifier;
      if (typeof identifier === 'string' && identifier in resources) {
        return [makeSearchHit('DOCUMENT', TEST_PUBLISHER, identifier)];
      }
      return [];
    },
    (ref) => {
      const value = resources[ref.identifier ?? ''];
      if (value === undefined) throw new Error('not found');
      return JSON.stringify(value);
    },
  );
}

describe('loadArchive', () => {
  it('is honestly unavailable when no publisher scope exists, without any request', async () => {
    const reader = createRecordingReader(
      () => {
        throw new Error('must not be called');
      },
      () => {
        throw new Error('must not be called');
      },
    );
    const snapshot = await loadArchive(UNSCOPED, { reader, cache: createContentCache() });
    expect(snapshot.status).toBe('unavailable');
    expect(snapshot.source).toBe('none');
    expect(reader.searches).toHaveLength(0);
  });

  it('reports ready for a complete catalog', async () => {
    const snapshot = await loadArchive(SCOPED, {
      reader: readerFor(catalogResources()),
      cache: createContentCache(),
      now: NOW,
    });
    expect(snapshot.status).toBe('ready');
    expect(snapshot.source).toBe('catalog');
    expect(snapshot.listings).toHaveLength(2);
  });

  it('reports confirmed empty only when the catalog is available and truly empty', async () => {
    const resources = {
      saw_cat_manifest: { ...clone(TEST_MANIFEST_FIXTURE), partitions: [] },
    };
    const snapshot = await loadArchive(SCOPED, {
      reader: readerFor(resources),
      cache: createContentCache(),
      now: NOW,
    });
    expect(snapshot.status).toBe('empty');
    expect(snapshot.source).toBe('catalog');
  });

  it('reports partial when a catalog partition cannot be read', async () => {
    const resources = catalogResources();
    delete resources.saw_cat_vid_p001;
    const snapshot = await loadArchive(SCOPED, {
      reader: readerFor(resources),
      cache: createContentCache(),
      now: NOW,
    });
    expect(snapshot.status).toBe('partial');
    expect(snapshot.partial).toBe(true);
    expect(snapshot.listings).toHaveLength(1);
  });

  it('reports stale when served from an expired-but-usable cache entry', async () => {
    const cache = createContentCache({ now: () => NOW });
    await cache.put('catalog:shadow archives:manifest', clone(TEST_MANIFEST_FIXTURE), {
      ttlMs: 1,
      version: 1,
    });
    await cache.put(
      'catalog:shadow archives:partition:saw_cat_post_p001',
      clone(TEST_PARTITION_FIXTURE),
      {
        ttlMs: 1,
        version: 3,
      },
    );
    await cache.put(
      'catalog:shadow archives:partition:saw_cat_vid_p001',
      catalogResources().saw_cat_vid_p001,
      { ttlMs: 1, version: 3 },
    );

    const snapshot = await loadArchive(SCOPED, {
      reader: createRecordingReader(
        () => [],
        () => '',
      ),
      cache,
      now: NOW + 1000,
    });
    expect(snapshot.status).toBe('stale');
    expect(snapshot.stale).toBe(true);
  });

  it('reports an error when the catalog read fails, never as empty', async () => {
    const reader = createRecordingReader(
      () => {
        throw new Error('node unreachable');
      },
      () => '',
    );
    const snapshot = await loadArchive(SCOPED, {
      reader,
      cache: createContentCache(),
      now: NOW,
    });
    expect(snapshot.status).toBe('error');
    expect(snapshot.error).not.toBeNull();
  });

  it('restores published entities the catalog is missing, from live discovery', async () => {
    const resources = catalogResources();
    const reader = createRecordingReader(
      (request) => {
        if (request.prefix && request.identifier === `saw_img_`) {
          return [makeSearchHit('DOCUMENT', TEST_PUBLISHER, `saw_img_${TEST_ITEM_ID}`)];
        }
        if (typeof request.identifier === 'string' && request.identifier in resources) {
          return [makeSearchHit('DOCUMENT', TEST_PUBLISHER, request.identifier)];
        }
        return [];
      },
      (ref) => {
        const value = resources[ref.identifier ?? ''];
        if (value === undefined) throw new Error('not found');
        return JSON.stringify(value);
      },
    );

    const snapshot = await loadArchive(SCOPED, {
      reader,
      cache: createContentCache(),
      now: NOW,
    });

    // The catalog is readable and still supplies the primary summaries, but a
    // published entity it does not carry is recovered from bounded discovery.
    expect(snapshot.source).toBe('catalog');
    expect(snapshot.partial).toBe(true);
    expect(snapshot.status).toBe('partial');
    expect(snapshot.listings.map((listing) => listing.id)).toContain(TEST_ITEM_ID);
    expect(snapshot.diagnostics.some((entry) => entry.code === 'catalog-reconciled')).toBe(true);
  });

  it('falls back to bounded live discovery when the catalog data cannot be read', async () => {
    const reader = createRecordingReader(
      (request) => {
        if (request.prefix && request.identifier === 'saw_post_') {
          return [makeSearchHit('DOCUMENT', TEST_PUBLISHER, `saw_post_${TEST_BLOG_ID}`)];
        }
        if (request.identifier === 'saw_cat_manifest') {
          return [makeSearchHit('DOCUMENT', TEST_PUBLISHER, 'saw_cat_manifest')];
        }
        return [];
      },
      () => {
        // The node can serve metadata while the resource bytes are missing.
        throw new Error('Data unavailable. Please try again later.');
      },
    );

    const snapshot = await loadArchive(SCOPED, {
      reader,
      cache: createContentCache(),
      now: NOW,
    });

    expect(snapshot.source).toBe('fallback');
    expect(snapshot.status).toBe('partial');
    expect(snapshot.listings.map((listing) => listing.id)).toEqual([TEST_BLOG_ID]);
    expect(snapshot.diagnostics.some((entry) => entry.code === 'catalog-unreadable')).toBe(true);
  });

  it('falls back to bounded live discovery when the catalog is absent, and stays partial', async () => {
    const reader = createRecordingReader(
      (request) => {
        if (request.prefix && request.identifier === 'saw_post_') {
          return [makeSearchHit('DOCUMENT', TEST_PUBLISHER, `saw_post_${TEST_BLOG_ID}`)];
        }
        return [];
      },
      () => '',
    );
    const snapshot = await loadArchive(SCOPED, {
      reader,
      cache: createContentCache(),
      now: NOW,
    });
    expect(snapshot.status).toBe('partial');
    expect(snapshot.source).toBe('fallback');
    expect(snapshot.partial).toBe(true);
    expect(snapshot.listings).toHaveLength(1);
  });

  it('never reports an empty archive when discovery itself failed', async () => {
    const reader = createRecordingReader(
      () => {
        throw new Error('network down');
      },
      () => '',
    );
    const snapshot = await loadArchive(SCOPED, {
      reader,
      cache: createContentCache(),
      now: NOW,
    });
    expect(snapshot.status).toBe('error');
    expect(snapshot.listings).toHaveLength(0);
    expect(snapshot.message).not.toMatch(/empty/i);
  });

  it('describes a zero-result bounded fallback without claiming the archive is empty', async () => {
    const reader = createRecordingReader(
      () => [],
      () => '',
    );
    const snapshot = await loadArchive(SCOPED, {
      reader,
      cache: createContentCache(),
      now: NOW,
    });
    expect(snapshot.status).toBe('partial');
    expect(snapshot.message).toMatch(/not proof that the archive is empty/i);
  });
});

/**
 * Gallery-item listings the derived index does not carry must still render:
 * the entity resource is authoritative and tiny, so a bounded hydration pass
 * resolves the thumbnail, album membership and canonical title for cards.
 */
describe('loadArchive gallery listing hydration', () => {
  function galleryReader(options: { readonly failEntity?: boolean } = {}) {
    const resources: Record<string, unknown> = catalogResources();
    resources[`saw_img_${TEST_ITEM_ID}`] = clone(TEST_ITEM_FIXTURE);
    resources[`saw_album_${TEST_ALBUM_ID}`] = clone(TEST_ALBUM_FIXTURE);
    const reader = createRecordingReader(
      (request) => {
        if (request.prefix && request.identifier === 'saw_img_') {
          return [makeSearchHit('DOCUMENT', TEST_PUBLISHER, `saw_img_${TEST_ITEM_ID}`)];
        }
        if (request.prefix && request.identifier === 'saw_album_') {
          return [makeSearchHit('DOCUMENT', TEST_PUBLISHER, `saw_album_${TEST_ALBUM_ID}`)];
        }
        if (typeof request.identifier === 'string' && request.identifier in resources) {
          return [makeSearchHit('DOCUMENT', TEST_PUBLISHER, request.identifier)];
        }
        return [];
      },
      (ref) => {
        if (options.failEntity && ref.identifier?.startsWith('saw_img_')) {
          throw new Error('Data unavailable. Please try again later.');
        }
        const value = resources[ref.identifier ?? ''];
        if (value === undefined) throw new Error('not found');
        return JSON.stringify(value);
      },
    );
    return reader;
  }

  it('resolves an item the index does not carry from its authoritative entity', async () => {
    const snapshot = await loadArchive(SCOPED, {
      reader: galleryReader(),
      cache: createContentCache(),
      now: NOW,
    });

    const item = snapshot.listings.find((listing) => listing.id === TEST_ITEM_ID);
    expect(item).toBeDefined();
    // The card can now render media, and the album page can resolve membership.
    expect(item?.thumbnail).toEqual({
      service: 'THUMBNAIL',
      name: TEST_PUBLISHER,
      identifier: 'saw_thumb_item00000001',
    });
    expect(item?.albumId).toBe(TEST_ALBUM_ID);
    expect(item?.title).toBe('Plate 01');
    expect(item?.width).toBe(1200);
    expect(snapshot.diagnostics.some((entry) => entry.code === 'listings-hydrated')).toBe(true);
  });

  it('hydrates gallery items in the bounded-discovery recovery path too', async () => {
    // No manifest at all: every listing comes from bounded discovery, and the
    // card still resolves media from the authoritative entity.
    const resources: Record<string, unknown> = {
      [`saw_img_${TEST_ITEM_ID}`]: clone(TEST_ITEM_FIXTURE),
    };
    const reader = createRecordingReader(
      (request) => {
        if (request.prefix && request.identifier === 'saw_img_') {
          return [makeSearchHit('DOCUMENT', TEST_PUBLISHER, `saw_img_${TEST_ITEM_ID}`)];
        }
        if (typeof request.identifier === 'string' && request.identifier in resources) {
          return [makeSearchHit('DOCUMENT', TEST_PUBLISHER, request.identifier)];
        }
        return [];
      },
      (ref) => {
        const value = resources[ref.identifier ?? ''];
        if (value === undefined) throw new Error('not found');
        return JSON.stringify(value);
      },
    );

    const snapshot = await loadArchive(SCOPED, {
      reader,
      cache: createContentCache(),
      now: NOW,
    });

    expect(snapshot.source).toBe('fallback');
    const item = snapshot.listings.find((listing) => listing.id === TEST_ITEM_ID);
    expect(item?.thumbnail?.identifier).toBe('saw_thumb_item00000001');
    expect(item?.albumId).toBe(TEST_ALBUM_ID);
  });

  it('keeps the discovery listing and reports a warning when its entity cannot be read', async () => {
    const snapshot = await loadArchive(SCOPED, {
      reader: galleryReader({ failEntity: true }),
      cache: createContentCache(),
      now: NOW,
    });

    const item = snapshot.listings.find((listing) => listing.id === TEST_ITEM_ID);
    expect(item).toBeDefined();
    expect(item?.thumbnail).toBeNull();
    expect(snapshot.listings.length).toBeGreaterThan(0);
    expect(snapshot.diagnostics.some((entry) => entry.code === 'listings-hydration-failed')).toBe(
      true,
    );
  });
});

describe('withDerivedAlbumCovers', () => {
  it('gives a coverless album the newest member item thumbnail, without inventing title data', () => {
    const album = makeListing({
      id: TEST_ALBUM_ID,
      type: 'gallery-album',
      identifier: `saw_album_${TEST_ALBUM_ID}`,
      title: 'Field plates',
      thumbnail: null,
      albumId: null,
      partitionIdentifier: 'fallback',
    });
    const older = makeListing({
      id: TEST_ITEM_ID,
      type: 'gallery-item',
      identifier: `saw_img_${TEST_ITEM_ID}`,
      updatedAt: 10,
      albumId: TEST_ALBUM_ID,
      thumbnail: { service: 'THUMBNAIL', name: TEST_PUBLISHER, identifier: 'thumb-older' },
    });
    const newer = makeListing({
      id: 'item00000002',
      type: 'gallery-item',
      identifier: 'saw_img_item00000002',
      updatedAt: 20,
      albumId: TEST_ALBUM_ID,
      thumbnail: { service: 'THUMBNAIL', name: TEST_PUBLISHER, identifier: 'thumb-newer' },
    });

    const result = withDerivedAlbumCovers([album, older, newer]);
    const covered = result.find((listing) => listing.id === TEST_ALBUM_ID);
    expect(covered?.thumbnail).toEqual({
      service: 'THUMBNAIL',
      name: TEST_PUBLISHER,
      identifier: 'thumb-newer',
    });
    expect(result.find((listing) => listing.id === TEST_ITEM_ID)?.thumbnail).toEqual(
      older.thumbnail,
    );
  });

  it('never overwrites an album cover that already exists', () => {
    const cover = { service: 'THUMBNAIL', name: TEST_PUBLISHER, identifier: 'own-cover' };
    const album = makeListing({
      id: TEST_ALBUM_ID,
      type: 'gallery-album',
      identifier: `saw_album_${TEST_ALBUM_ID}`,
      thumbnail: cover,
    });
    const item = makeListing({
      id: TEST_ITEM_ID,
      type: 'gallery-item',
      identifier: `saw_img_${TEST_ITEM_ID}`,
      updatedAt: 99,
      albumId: TEST_ALBUM_ID,
      thumbnail: { service: 'THUMBNAIL', name: TEST_PUBLISHER, identifier: 'newer' },
    });
    expect(withDerivedAlbumCovers([album, item])[0]?.thumbnail).toEqual(cover);
  });
});

describe('loadEntityDetail', () => {
  function entityReader(payload: unknown) {
    const resources = { [`saw_post_${TEST_BLOG_ID}`]: payload };
    return readerFor(resources);
  }

  it('is unavailable without a publisher scope', async () => {
    const result = await loadEntityDetail(UNSCOPED, 'blog-post', TEST_BLOG_ID, {
      reader: createRecordingReader(
        () => [],
        () => '',
      ),
    });
    expect(result.status).toBe('unavailable');
  });

  it('rejects a reference that is not a stable id', async () => {
    const result = await loadEntityDetail(SCOPED, 'blog-post', 'not-an-id', {
      reader: createRecordingReader(
        () => [],
        () => '',
      ),
    });
    expect(result.status).toBe('invalid');
  });

  it('fetches and validates the authoritative entity', async () => {
    const result = await loadEntityDetail(SCOPED, 'blog-post', TEST_BLOG_ID, {
      reader: entityReader(TEST_BLOG_FIXTURE),
      cache: createContentCache(),
    });
    expect(result.status).toBe('ready');
    expect(result.entity?.kind).toBe('blog-post');
  });

  it('accepts the full identifier form as well as the bare stable id', async () => {
    const result = await loadEntityDetail(SCOPED, 'blog-post', `saw_post_${TEST_BLOG_ID}`, {
      reader: entityReader(TEST_BLOG_FIXTURE),
      cache: createContentCache(),
    });
    expect(result.status).toBe('ready');
    expect(result.entity?.id).toBe(TEST_BLOG_ID);
  });

  it('rejects a full identifier belonging to a different kind', async () => {
    const result = await loadEntityDetail(SCOPED, 'blog-post', `saw_vid_${TEST_BLOG_ID}`, {
      reader: entityReader(TEST_BLOG_FIXTURE),
      cache: createContentCache(),
    });
    expect(result.status).toBe('invalid');
  });

  it('maps a withdrawn entity to the withdrawn state', async () => {
    const result = await loadEntityDetail(SCOPED, 'blog-post', TEST_BLOG_ID, {
      reader: entityReader({ ...clone(TEST_BLOG_FIXTURE), state: 'withdrawn' }),
      cache: createContentCache(),
    });
    expect(result.status).toBe('withdrawn');
  });

  it('rejects an entity whose payload id disagrees with the requested resource', async () => {
    const payload = { ...clone(TEST_BLOG_FIXTURE), id: TEST_VIDEO_ID };
    const result = await loadEntityDetail(SCOPED, 'blog-post', TEST_BLOG_ID, {
      reader: entityReader(payload),
      cache: createContentCache(),
    });
    expect(result.status).toBe('invalid');
  });

  it('rejects an unsupported schema as invalid', async () => {
    const result = await loadEntityDetail(SCOPED, 'blog-post', TEST_BLOG_ID, {
      reader: entityReader({ ...clone(TEST_BLOG_FIXTURE), schemaVersion: 7 }),
      cache: createContentCache(),
    });
    expect(result.status).toBe('invalid');
    expect(result.error?.kind).toBe('unsupported-schema');
  });

  it('fails safely on malformed JSON without throwing', async () => {
    const reader = createRecordingReader(
      (request) =>
        request.identifier === `saw_post_${TEST_BLOG_ID}`
          ? [makeSearchHit('DOCUMENT', TEST_PUBLISHER, request.identifier)]
          : [],
      () => '{not json',
    );
    const result = await loadEntityDetail(SCOPED, 'blog-post', TEST_BLOG_ID, {
      reader,
      cache: createContentCache(),
    });
    expect(result.status).toBe('error');
    expect(result.entity).toBeNull();
  });

  it('reports a missing resource distinctly from an error', async () => {
    const result = await loadEntityDetail(SCOPED, 'blog-post', TEST_BLOG_ID, {
      reader: createRecordingReader(
        () => [],
        () => '',
      ),
      cache: createContentCache(),
    });
    expect(result.status).toBe('missing');
  });

  it('rejects a payload whose kind does not match the route', async () => {
    // A blog-post payload published under the video identifier space.
    const reader = readerFor({ [`saw_vid_${TEST_BLOG_ID}`]: TEST_BLOG_FIXTURE });
    const result = await loadEntityDetail(SCOPED, 'video', TEST_BLOG_ID, {
      reader,
      cache: createContentCache(),
    });
    expect(result.status).toBe('invalid');
  });
});

describe('aggregateTaxonomy', () => {
  it('dedupes and sorts category/tag references from listings', () => {
    const taxonomy = aggregateTaxonomy([
      makeListing({ categories: ['Field Notes', 'field notes'], tags: ['Archive'] }),
      makeListing({ id: TEST_VIDEO_ID, type: 'video', categories: ['Blog'], tags: [] }),
    ]);
    expect(taxonomy.categories.map((entry) => entry.label)).toEqual(['Blog', 'Field Notes']);
    expect(taxonomy.tags.map((entry) => entry.label)).toEqual(['Archive']);
  });
});

describe('filterListings', () => {
  const listings = [
    makeListing({ categories: ['Field Notes'], tags: ['Archive'], title: 'Redaction notes' }),
    makeListing({
      id: TEST_VIDEO_ID,
      type: 'video',
      identifier: `saw_vid_${TEST_VIDEO_ID}`,
      slug: 'field-footage',
      categories: ['Screening'],
      tags: ['Archive'],
      title: 'Field footage',
      excerpt: 'Raw footage.',
    }),
  ];

  it('filters by type, category and tag using canonical slugs', () => {
    expect(filterListings(listings, { type: 'video' })).toHaveLength(1);
    expect(filterListings(listings, { category: 'field-notes' })).toHaveLength(1);
    expect(filterListings(listings, { tag: 'archive' })).toHaveLength(2);
    expect(filterListings(listings, { tag: 'missing' })).toHaveLength(0);
  });

  it('filters by a local substring query over listing metadata only', () => {
    expect(filterListings(listings, { query: 'footage' })).toHaveLength(1);
    expect(filterListings(listings, { query: 'REDACTION' })).toHaveLength(1);
    expect(filterListings(listings, { query: 'nothing' })).toHaveLength(0);
    expect(filterListings(listings, { query: '  ' })).toHaveLength(2);
  });
});

describe('paginate', () => {
  const items = [1, 2, 3, 4, 5];

  it('clamps the page into range and reports navigation flags', () => {
    expect(paginate(items, 2, 2)).toMatchObject({
      items: [3, 4],
      page: 2,
      pageCount: 3,
      hasPrevious: true,
      hasNext: true,
    });
    expect(paginate(items, 99, 2).page).toBe(3);
    expect(paginate(items, 0, 2).page).toBe(1);
    expect(paginate([], 1, 20)).toMatchObject({ page: 1, pageCount: 1, hasNext: false });
  });
});
