import { describe, expect, it, vi } from 'vitest';

import {
  collectionStateFromSnapshot,
  formatDuration,
  listingHref,
  listingToCard,
  typeLabel,
} from './listingModel';
import type { ArchiveSnapshot } from '../../../services/types';
import type { ArchiveStatus, ArchiveSource } from '../../../services/types';
import { TEST_BLOG_ID, TEST_VIDEO_ID } from '../../../test/fixtures/content';
import type { CatalogListing } from '../../../domain';

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

function makeSnapshot(
  status: ArchiveStatus,
  overrides: Partial<ArchiveSnapshot> = {},
): ArchiveSnapshot {
  return {
    status,
    source: 'catalog',
    listings: [],
    taxonomy: { categories: [], tags: [] },
    compiledAt: null,
    stale: false,
    partial: false,
    message: null,
    error: null,
    diagnostics: [],
    ...overrides,
  };
}

describe('listingHref', () => {
  it('maps each entity type to its canonical detail route', () => {
    expect(listingHref(makeListing())).toBe(`/blog/${TEST_BLOG_ID}`);
    expect(listingHref(makeListing({ type: 'video', id: TEST_VIDEO_ID }))).toBe(
      `/videos/${TEST_VIDEO_ID}`,
    );
    expect(listingHref(makeListing({ type: 'gallery-album' }))).toBe(
      `/gallery/album/${TEST_BLOG_ID}`,
    );
    expect(listingHref(makeListing({ type: 'gallery-item' }))).toBe(
      `/gallery/item/${TEST_BLOG_ID}`,
    );
  });
});

describe('listingToCard', () => {
  it('builds a thumbnail-only card with geometry and no video bytes', () => {
    const card = listingToCard(
      makeListing({
        type: 'video',
        id: TEST_VIDEO_ID,
        durationSeconds: 93,
        thumbnail: {
          service: 'THUMBNAIL',
          name: 'Shadow Archives',
          identifier: 'saw_thumb_x',
        },
      }),
    );
    expect(card.kind).toBe('video');
    expect(card.durationLabel).toBe('1:33');
    expect(card.media?.src).toBe('/arbitrary/THUMBNAIL/Shadow%20Archives/saw_thumb_x');
    expect(card.href).toBe(`/videos/${TEST_VIDEO_ID}`);
  });

  it('falls back to a placeholder dimension when the contract has none', () => {
    const gallery = listingToCard(
      makeListing({
        type: 'gallery-item',
        thumbnail: { service: 'THUMBNAIL', name: 'N', identifier: 'i' },
      }),
    );
    expect(gallery.media).toMatchObject({ width: 4, height: 3 });
  });

  it('uses an explicit title fallback rather than rendering an empty card', () => {
    expect(listingToCard(makeListing({ title: '' })).title).toBe('Untitled');
  });
});

describe('collectionStateFromSnapshot', () => {
  const item = { id: 'x' };

  it('never reports empty for a failed, partial or unavailable discovery', () => {
    expect(collectionStateFromSnapshot(makeSnapshot('error'), []).status).toBe('error');
    expect(collectionStateFromSnapshot(makeSnapshot('unavailable'), []).status).toBe('unavailable');
    expect(collectionStateFromSnapshot(makeSnapshot('partial'), []).status).toBe('unavailable');
    expect(collectionStateFromSnapshot(makeSnapshot('loading'), []).status).toBe('loading');
  });

  it('reports confirmed empty only for an empty snapshot', () => {
    expect(collectionStateFromSnapshot(makeSnapshot('empty'), []).status).toBe('empty');
  });

  it('renders partial results when some items are available', () => {
    const state = collectionStateFromSnapshot(makeSnapshot('partial', { partial: true }), [item]);
    expect(state.status).toBe('ready');
    expect(state.partial).toBe(true);
    expect(state.items).toEqual([item]);
  });

  it('carries the stale marker through', () => {
    const state = collectionStateFromSnapshot(makeSnapshot('stale', { stale: true }), [item]);
    expect(state.status).toBe('ready');
    expect(state.stale).toBe(true);
  });

  it('does not treat a non-catalog source as complete', () => {
    const source: ArchiveSource = 'fallback';
    const state = collectionStateFromSnapshot(
      makeSnapshot('partial', { source, partial: true, message: 'bounded' }),
      [item],
    );
    expect(state.source).toBe('fallback');
    expect(state.message).toBe('bounded');
  });

  it('passes the retry callback through for error states', () => {
    const onRetry = vi.fn();
    const state = collectionStateFromSnapshot(makeSnapshot('error'), [], onRetry);
    expect(state.onRetry).toBe(onRetry);
  });
});

describe('formatDuration', () => {
  it('formats mm:ss and h:mm:ss', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(93)).toBe('1:33');
    expect(formatDuration(3661)).toBe('1:01:01');
  });
});

describe('typeLabel', () => {
  it('labels every entity kind', () => {
    expect(typeLabel('blog-post')).toBe('Blog post');
    expect(typeLabel('video')).toBe('Video');
    expect(typeLabel('gallery-item')).toBe('Gallery item');
    expect(typeLabel('gallery-album')).toBe('Gallery album');
  });
});
