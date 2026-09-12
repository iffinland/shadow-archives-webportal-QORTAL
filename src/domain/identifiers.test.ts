import { describe, expect, it } from 'vitest';

import {
  buildEntityIdentifier,
  discoveryPrefix,
  isCatalogIdentifier,
  buildGalleryMediaIdentifier,
  buildGalleryThumbnailIdentifier,
  generateStableId,
  generateUniqueStableId,
  isStableId,
  parseEntityIdentifier,
  parseGalleryMediaIdentifier,
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

describe('generateStableId (Phase 3A)', () => {
  it('produces exactly 12 lowercase base36 characters from the entropy source', () => {
    const id = generateStableId((length) => new Uint8Array(length).fill(10));
    expect(id).toBe('aaaaaaaaaaaa');
    expect(isStableId(id)).toBe(true);
  });

  it('skips bytes at or above the rejection threshold so modulo stays uniform', () => {
    const bytes = [252, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
    // Each call skips the out-of-range 252 and contributes the remaining 11
    // characters, so the second call supplies the 12th character.
    const id = generateStableId(() => new Uint8Array(bytes));
    expect(id).toBe('abcdefghijka');
  });

  it('throws instead of inventing weak randomness when the crypto source is replaced', () => {
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: undefined });
    try {
      expect(() => generateStableId()).toThrowError(/Cryptographically secure randomness/);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { configurable: true, value: original });
    }
  });
});

describe('generateUniqueStableId (Phase 3A)', () => {
  it('returns the first candidate that is not taken', async () => {
    let call = 0;
    const random = (length: number): Uint8Array => {
      const bytes = new Uint8Array(length);
      bytes.fill(call % 36);
      call += 1;
      return bytes;
    };
    const taken = new Set(['000000000000']);

    const id = await generateUniqueStableId((candidate) => taken.has(candidate), {
      maxAttempts: 4,
      random,
    });

    expect(id).toBe('111111111111');
  });

  it('throws after the bounded retry budget is exhausted instead of looping forever', async () => {
    await expect(
      generateUniqueStableId(() => true, {
        maxAttempts: 3,
        random: (length) => new Uint8Array(length).fill(10),
      }),
    ).rejects.toThrowError(/unique gallery id/);
  });
});

describe('gallery media identifiers (Phase 3A)', () => {
  it('derives the media and thumbnail identifiers from the item id', () => {
    expect(buildGalleryMediaIdentifier(TEST_ITEM_ID)).toBe(`saw_img_media_${TEST_ITEM_ID}`);
    expect(buildGalleryThumbnailIdentifier(TEST_ITEM_ID)).toBe(`saw_img_thumb_${TEST_ITEM_ID}`);
  });

  it('parses a related media identifier back to its family and item id', () => {
    expect(parseGalleryMediaIdentifier(`saw_img_media_${TEST_ITEM_ID}`)).toEqual({
      kind: 'media',
      id: TEST_ITEM_ID,
    });
    expect(parseGalleryMediaIdentifier(`saw_img_thumb_${TEST_ITEM_ID}`)).toEqual({
      kind: 'thumbnail',
      id: TEST_ITEM_ID,
    });
  });

  it('rejects the entity identifier and malformed media identifiers', () => {
    expect(parseGalleryMediaIdentifier(`saw_img_${TEST_ITEM_ID}`)).toBeNull();
    expect(parseGalleryMediaIdentifier(`saw_img_media_short`)).toBeNull();
    expect(parseGalleryMediaIdentifier(null)).toBeNull();
  });
});
