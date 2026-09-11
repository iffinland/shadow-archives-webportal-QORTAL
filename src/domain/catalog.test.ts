import { describe, expect, it } from 'vitest';

import { validateCatalogEntry, validateCatalogManifest, validateCatalogPartition } from './catalog';
import {
  TEST_BLOG_ID,
  TEST_MANIFEST_FIXTURE,
  TEST_PARTITION_FIXTURE,
  TEST_VIDEO_ID,
  makeCatalogEntry,
} from '../test/fixtures/content';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('validateCatalogManifest', () => {
  it('accepts the approved manifest shape', () => {
    const result = validateCatalogManifest(TEST_MANIFEST_FIXTURE);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.catalogVersion).toBe(3);
      expect(result.value.partitions).toHaveLength(2);
      expect(result.value.taxonomy.categories).toEqual(['Field Notes']);
    }
  });

  it('rejects wrong schema, unknown kind, bad version or bad partitions', () => {
    expect(validateCatalogManifest({ ...clone(TEST_MANIFEST_FIXTURE), schemaVersion: 9 }).ok).toBe(
      false,
    );
    expect(validateCatalogManifest({ ...clone(TEST_MANIFEST_FIXTURE), kind: 'manifest' }).ok).toBe(
      false,
    );
    expect(validateCatalogManifest({ ...clone(TEST_MANIFEST_FIXTURE), catalogVersion: 0 }).ok).toBe(
      false,
    );
    expect(
      validateCatalogManifest({ ...clone(TEST_MANIFEST_FIXTURE), partitions: 'nope' }).ok,
    ).toBe(false);
  });

  it('rejects a partition descriptor whose token does not match its type', () => {
    const manifest = clone(TEST_MANIFEST_FIXTURE) as unknown as {
      partitions: Array<Record<string, unknown>>;
    };
    manifest.partitions[0].identifier = 'saw_cat_vid_p001';
    expect(validateCatalogManifest(manifest).ok).toBe(false);
  });

  it('rejects a partition identifier outside the catalog namespace', () => {
    const manifest = clone(TEST_MANIFEST_FIXTURE) as unknown as {
      partitions: Array<Record<string, unknown>>;
    };
    manifest.partitions[0].identifier = 'saw_post_p001';
    expect(validateCatalogManifest(manifest).ok).toBe(false);
  });
});

describe('validateCatalogEntry', () => {
  it('rejects a wrong or missing service', () => {
    expect(
      validateCatalogEntry(
        makeCatalogEntry('blog-post', TEST_BLOG_ID, { service: 'APP' }),
        'blog-post',
      ).ok,
    ).toBe(false);
  });

  it('rejects an identifier that does not belong to the type and id', () => {
    const wrongId = makeCatalogEntry('blog-post', TEST_BLOG_ID, {
      identifier: `saw_post_${TEST_VIDEO_ID}`,
    });
    expect(validateCatalogEntry(wrongId, 'blog-post').ok).toBe(false);
  });

  it('rejects a cross-type identifier (wrong entity kind)', () => {
    const wrongKind = makeCatalogEntry('blog-post', TEST_BLOG_ID, {
      identifier: `saw_vid_${TEST_BLOG_ID}`,
    });
    expect(validateCatalogEntry(wrongKind, 'blog-post').ok).toBe(false);
  });

  it('rejects malformed entries without throwing', () => {
    expect(validateCatalogEntry(null, 'blog-post').ok).toBe(false);
    expect(validateCatalogEntry({ id: 'nope' }, 'blog-post').ok).toBe(false);
    const noTitle = makeCatalogEntry('blog-post', TEST_BLOG_ID) as Record<string, unknown>;
    delete noTitle.title;
    expect(validateCatalogEntry(noTitle, 'blog-post').ok).toBe(false);
  });
});

describe('validateCatalogPartition', () => {
  it('accepts a valid partition and tags listings with their type', () => {
    const result = validateCatalogPartition(
      TEST_PARTITION_FIXTURE,
      'blog-post',
      'saw_cat_post_p001',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.listings).toHaveLength(1);
      expect(result.value.listings[0].type).toBe('blog-post');
      expect(result.value.listings[0].partitionIdentifier).toBe('saw_cat_post_p001');
      expect(result.value.rejectedEntries).toBe(0);
    }
  });

  it('isolates one malformed entry instead of failing the whole partition', () => {
    const partition = clone(TEST_PARTITION_FIXTURE) as unknown as {
      entries: Array<Record<string, unknown>>;
    };
    partition.entries.push({ id: 'broken' });
    partition.entries.push(makeCatalogEntry('blog-post', TEST_VIDEO_ID));
    const result = validateCatalogPartition(partition, 'blog-post', 'saw_cat_post_p001');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.listings).toHaveLength(2);
      expect(result.value.rejectedEntries).toBe(1);
    }
  });

  it('rejects an unsupported partition schema', () => {
    const partition = { ...clone(TEST_PARTITION_FIXTURE), schemaVersion: 4 };
    const result = validateCatalogPartition(partition, 'blog-post', 'saw_cat_post_p001');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unsupported-schema');
  });

  it('rejects a partition whose type disagrees with the manifest descriptor', () => {
    const result = validateCatalogPartition(TEST_PARTITION_FIXTURE, 'video', 'saw_cat_post_p001');
    expect(result.ok).toBe(false);
  });

  it('rejects an unbounded entries array', () => {
    const partition = { ...clone(TEST_PARTITION_FIXTURE), entries: new Array(600).fill(null) };
    const result = validateCatalogPartition(partition, 'blog-post', 'saw_cat_post_p001');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('too-large');
  });
});
