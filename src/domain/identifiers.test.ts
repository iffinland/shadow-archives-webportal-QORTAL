import { describe, expect, it } from 'vitest';

import {
  buildEntityIdentifier,
  discoveryPrefix,
  isCatalogIdentifier,
  isStableId,
  parseEntityIdentifier,
  resolveEntityReference,
} from './identifiers';
import { TEST_ALBUM_ID, TEST_BLOG_ID, TEST_ITEM_ID, TEST_VIDEO_ID } from '../test/fixtures/content';

describe('isStableId', () => {
  it('accepts exactly 12 lowercase base36 characters', () => {
    expect(isStableId('abc123def456')).toBe(true);
    expect(isStableId('000000000000')).toBe(true);
  });

  it('rejects wrong length, uppercase or non-base36 values', () => {
    expect(isStableId('abc123def45')).toBe(false);
    expect(isStableId('abc123def4567')).toBe(false);
    expect(isStableId('ABC123DEF456')).toBe(false);
    expect(isStableId('abc123def45-')).toBe(false);
    expect(isStableId(null)).toBe(false);
    expect(isStableId(42)).toBe(false);
  });
});

describe('buildEntityIdentifier', () => {
  it('uses the kind prefix from the contract', () => {
    expect(buildEntityIdentifier('blog-post', TEST_BLOG_ID)).toBe(`saw_post_${TEST_BLOG_ID}`);
    expect(buildEntityIdentifier('video', TEST_VIDEO_ID)).toBe(`saw_vid_${TEST_VIDEO_ID}`);
    expect(buildEntityIdentifier('gallery-item', TEST_ITEM_ID)).toBe(`saw_img_${TEST_ITEM_ID}`);
    expect(buildEntityIdentifier('gallery-album', TEST_ALBUM_ID)).toBe(
      `saw_album_${TEST_ALBUM_ID}`,
    );
  });
});

describe('parseEntityIdentifier', () => {
  it('parses a well-formed identifier back to kind and id', () => {
    const parsed = parseEntityIdentifier(`saw_post_${TEST_BLOG_ID}`);
    expect(parsed).toEqual({ kind: 'blog-post', id: TEST_BLOG_ID });
  });

  it('rejects substring/prefix collisions rather than accepting them', () => {
    // Trailing characters after the stable id must not be tolerated.
    expect(parseEntityIdentifier(`saw_post_${TEST_BLOG_ID}x`)).toBeNull();
    // A shorter-than-12 id is not a stable id.
    expect(parseEntityIdentifier('saw_post_abc')).toBeNull();
    // The right shape under the wrong namespace.
    expect(parseEntityIdentifier(`xyz_post_${TEST_BLOG_ID}`)).toBeNull();
    // Catalog identifiers are not entity identifiers.
    expect(parseEntityIdentifier('saw_cat_manifest')).toBeNull();
  });

  it('rejects non-string and whitespace/slash values', () => {
    expect(parseEntityIdentifier(null)).toBeNull();
    expect(parseEntityIdentifier(123)).toBeNull();
    expect(parseEntityIdentifier('saw post abc')).toBeNull();
    expect(parseEntityIdentifier('saw/post/abc')).toBeNull();
  });
});

describe('isCatalogIdentifier', () => {
  it('recognises only the manifest and partition namespace', () => {
    expect(isCatalogIdentifier('saw_cat_manifest')).toBe(true);
    expect(isCatalogIdentifier('saw_cat_post_p001')).toBe(true);
    expect(isCatalogIdentifier('saw_post_abc')).toBe(false);
    expect(isCatalogIdentifier(null)).toBe(false);
  });
});

describe('discoveryPrefix', () => {
  it('maps each kind to its identifier prefix', () => {
    expect(discoveryPrefix('blog-post')).toBe('saw_post_');
    expect(discoveryPrefix('video')).toBe('saw_vid_');
    expect(discoveryPrefix('gallery-item')).toBe('saw_img_');
    expect(discoveryPrefix('gallery-album')).toBe('saw_album_');
  });
});

describe('resolveEntityReference', () => {
  it('accepts a bare stable id unchanged', () => {
    expect(resolveEntityReference('blog-post', TEST_BLOG_ID)).toBe(TEST_BLOG_ID);
  });

  it('accepts the full identifier when the kind matches', () => {
    expect(resolveEntityReference('video', `saw_vid_${TEST_VIDEO_ID}`)).toBe(TEST_VIDEO_ID);
    expect(resolveEntityReference('gallery-album', `saw_album_${TEST_ALBUM_ID}`)).toBe(
      TEST_ALBUM_ID,
    );
  });

  it('rejects a full identifier for a different kind or a malformed value', () => {
    expect(resolveEntityReference('blog-post', `saw_vid_${TEST_VIDEO_ID}`)).toBeNull();
    expect(resolveEntityReference('blog-post', 'not-an-id')).toBeNull();
    expect(resolveEntityReference('blog-post', null)).toBeNull();
    expect(resolveEntityReference('blog-post', `saw_post_${TEST_BLOG_ID}extra`)).toBeNull();
  });
});
