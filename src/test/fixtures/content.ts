/**
 * TEST-ONLY Shadow Archives fixtures.
 *
 * These values are synthetic. They are never shipped to the archive, never
 * published to QDN and never used as production seed data; they exist so the
 * runtime validators and read pipeline can be exercised deterministically.
 */

import { buildEntityIdentifier } from '../../domain';

export const TEST_PUBLISHER = 'Shadow Archives';
export const TEST_BLOG_ID = 'blog00000001';
export const TEST_VIDEO_ID = 'vid000000001';
export const TEST_ITEM_ID = 'item00000001';
export const TEST_ALBUM_ID = 'album0000001';
export const TEST_CREATED_AT = 1_700_000_000_000;
export const TEST_UPDATED_AT = 1_700_000_500_000;

function media(service: string, identifier: string) {
  return { service, name: TEST_PUBLISHER, identifier };
}

export const TEST_BLOG_FIXTURE = {
  schemaVersion: 1,
  kind: 'blog-post',
  id: TEST_BLOG_ID,
  publisher: TEST_PUBLISHER,
  createdAt: TEST_CREATED_AT,
  updatedAt: TEST_UPDATED_AT,
  state: 'active',
  data: {
    title: 'Redaction notes',
    slug: 'redaction-notes',
    excerpt: 'A short archive excerpt.',
    body: {
      format: 'tiptap-json-v1',
      doc: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Visible text.' }],
          },
        ],
      },
    },
    bodyText: 'Visible text.',
    thumbnail: media('THUMBNAIL', 'saw_thumb_blog00000001'),
    categories: ['Field Notes'],
    tags: ['Archive'],
    language: 'en',
  },
} as const;

export const TEST_VIDEO_FIXTURE = {
  schemaVersion: 1,
  kind: 'video',
  id: TEST_VIDEO_ID,
  publisher: TEST_PUBLISHER,
  createdAt: TEST_CREATED_AT,
  updatedAt: TEST_UPDATED_AT,
  state: 'active',
  data: {
    title: 'Field footage',
    slug: 'field-footage',
    description: 'Stored metadata only.',
    media: media('VIDEO', 'saw_vid_vid000000001'),
    externalMedia: null,
    thumbnail: media('THUMBNAIL', 'saw_thumb_vid000000001'),
    durationSeconds: 93.5,
    categories: ['Field Notes'],
    tags: ['Archive'],
    language: 'en',
  },
} as const;

export const TEST_ITEM_FIXTURE = {
  schemaVersion: 1,
  kind: 'gallery-item',
  id: TEST_ITEM_ID,
  publisher: TEST_PUBLISHER,
  createdAt: TEST_CREATED_AT,
  updatedAt: TEST_UPDATED_AT,
  state: 'active',
  data: {
    title: 'Plate 01',
    description: 'A stored plate.',
    albumId: TEST_ALBUM_ID,
    media: media('IMAGE', 'saw_img_item00000001'),
    thumbnail: media('THUMBNAIL', 'saw_thumb_item00000001'),
    width: 1200,
    height: 800,
    categories: ['Field Notes'],
    tags: ['Archive'],
    language: 'en',
  },
} as const;

export const TEST_ALBUM_FIXTURE = {
  schemaVersion: 1,
  kind: 'gallery-album',
  id: TEST_ALBUM_ID,
  publisher: TEST_PUBLISHER,
  createdAt: TEST_CREATED_AT,
  updatedAt: TEST_UPDATED_AT,
  state: 'active',
  data: {
    title: 'Field plates',
    description: 'An album of stored plates.',
    coverThumbnail: media('THUMBNAIL', 'saw_thumb_album0000001'),
    categories: ['Field Notes'],
    tags: ['Archive'],
    language: 'en',
  },
} as const;

/** Build a catalog entry for `kind`/`id` with listing-appropriate defaults. */
export function makeCatalogEntry(
  kind: 'blog-post' | 'video' | 'gallery-item' | 'gallery-album',
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const template = {
    'blog-post': {
      title: 'Redaction notes',
      slug: 'redaction-notes',
      excerpt: 'A short archive excerpt.',
      durationSeconds: null,
      width: null,
      height: null,
      albumId: null,
    },
    video: {
      title: 'Field footage',
      slug: 'field-footage',
      excerpt: '',
      durationSeconds: 93.5,
      width: null,
      height: null,
      albumId: null,
    },
    'gallery-item': {
      title: 'Plate 01',
      slug: 'plate-01',
      excerpt: '',
      durationSeconds: null,
      width: 1200,
      height: 800,
      albumId: TEST_ALBUM_ID,
    },
    'gallery-album': {
      title: 'Field plates',
      slug: 'field-plates',
      excerpt: '',
      durationSeconds: null,
      width: null,
      height: null,
      albumId: null,
    },
  }[kind];

  return {
    id,
    service: 'DOCUMENT',
    identifier: buildEntityIdentifier(kind, id),
    ...template,
    createdAt: TEST_CREATED_AT,
    updatedAt: TEST_UPDATED_AT,
    categories: ['Field Notes'],
    tags: ['Archive'],
    thumbnail: null,
    state: 'active',
    contentHash: null,
    likeCount: null,
    commentCount: null,
    countsCompiledAt: null,
    ...overrides,
  };
}

export const TEST_MANIFEST_FIXTURE = {
  schemaVersion: 1,
  kind: 'catalog-manifest',
  catalogVersion: 3,
  compiledAt: TEST_UPDATED_AT,
  publisherName: TEST_PUBLISHER,
  partitions: [
    {
      identifier: 'saw_cat_post_p001',
      type: 'blog-post',
      count: 1,
      maxUpdated: TEST_UPDATED_AT,
      checksum: 'test-checksum-post',
    },
    {
      identifier: 'saw_cat_vid_p001',
      type: 'video',
      count: 1,
      maxUpdated: TEST_UPDATED_AT,
      checksum: 'test-checksum-vid',
    },
  ],
  taxonomy: { categories: ['Field Notes'], tags: ['Archive'] },
} as const;

export const TEST_PARTITION_FIXTURE = {
  schemaVersion: 1,
  kind: 'catalog-partition',
  type: 'blog-post',
  partition: 1,
  compiledAt: TEST_UPDATED_AT,
  entries: [makeCatalogEntry('blog-post', TEST_BLOG_ID)],
} as const;

/** A minimal, safe TipTap document. */
export const SAFE_RICH_TEXT_DOC = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Safe text.' }],
    },
  ],
} as const;

export interface MaliciousRichTextCase {
  readonly name: string;
  readonly doc: Record<string, unknown>;
  /** Substring that must never appear in the rendered output. */
  readonly forbidden: string;
}

/**
 * Hostile/unsupported rich-text documents. Each must fail safely: the payload
 * must not be able to introduce executable markup, event handlers or unsafe
 * URL schemes.
 */
export const MALICIOUS_RICH_TEXT_CASES: readonly MaliciousRichTextCase[] = [
  {
    name: 'script tag as a text node',
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: '<script>alert(1)</script>' }],
        },
      ],
    },
    forbidden: '<script>',
  },
  {
    name: 'raw html node',
    doc: {
      type: 'doc',
      content: [{ type: 'html', html: '<img src=x onerror=alert(1)>' }],
    },
    forbidden: 'onerror',
  },
  {
    name: 'javascript link mark',
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'click me',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      ],
    },
    forbidden: 'javascript:',
  },
  {
    name: 'data url link mark',
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'payload',
              marks: [
                {
                  type: 'link',
                  attrs: { href: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==' },
                },
              ],
            },
          ],
        },
      ],
    },
    forbidden: 'data:text/html',
  },
  {
    name: 'event-handler attribute on image',
    doc: {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: { src: '/arbitrary/THUMBNAIL/Shadow Archives/ok.webp', onerror: 'alert(1)' },
        },
      ],
    },
    forbidden: 'onerror',
  },
  {
    name: 'javascript image source',
    doc: {
      type: 'doc',
      content: [{ type: 'image', attrs: { src: 'javascript:alert(1)' } }],
    },
    forbidden: 'javascript:',
  },
  {
    name: 'nested unexpected object as text',
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: { evil: '<script>x</script>' } }],
        },
      ],
    },
    forbidden: '<script>',
  },
  {
    name: 'unknown node wrapping text',
    doc: {
      type: 'doc',
      content: [
        {
          type: 'mysteryNode',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'survives' }] }],
        },
      ],
    },
    forbidden: 'mysteryNode',
  },
  {
    name: 'style injection via textStyle colour',
    doc: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'styled',
              marks: [
                { type: 'textStyle', attrs: { color: 'red;}</style><script>alert(1)</script>' } },
              ],
            },
          ],
        },
      ],
    },
    forbidden: '<script>',
  },
];

/** A validated listing record, shaped like the domain `CatalogListing`. */
export function makeListingFixture(
  overrides: Partial<import('../../domain').CatalogListing> = {},
): import('../../domain').CatalogListing {
  return {
    id: TEST_BLOG_ID,
    type: 'blog-post',
    service: 'DOCUMENT',
    identifier: `saw_post_${TEST_BLOG_ID}`,
    title: 'Redaction notes',
    slug: 'redaction-notes',
    excerpt: 'A short archive excerpt.',
    createdAt: TEST_CREATED_AT,
    updatedAt: TEST_UPDATED_AT,
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

/** A ready archive snapshot carrying the supplied listings. */
export function makeArchiveSnapshot(
  overrides: Partial<import('../../services/types').ArchiveSnapshot> = {},
): import('../../services/types').ArchiveSnapshot {
  return {
    status: 'ready',
    source: 'catalog',
    listings: [],
    taxonomy: { categories: [], tags: [] },
    compiledAt: TEST_UPDATED_AT,
    stale: false,
    partial: false,
    message: null,
    error: null,
    diagnostics: [],
    ...overrides,
  };
}
