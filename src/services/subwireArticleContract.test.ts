import { describe, expect, it } from 'vitest';

import { LIMITS } from '../domain/constants';
import type { RichTextDocument } from '../domain/types';
import { richTextToMarkdown } from '../domain/richTextMarkdown';
import {
  buildSubwireArticle,
  isSubwireRenderableArticle,
  parseSubwireArticleIdentifier,
  subwireArticleIdentifier,
  subwireArticleIdentifierPrefix,
  subwireArticleUrl,
  subwireCoreDescription,
  subwireCoreTitle,
  truncateUtf8Bytes,
  SUBWIRE_ARTICLE_DISCOVERY_REQUEST,
} from './subwireArticleContract';

/**
 * The expected prefix is not a self-fulfilling fixture: it was independently
 * derived from qapp-core's `hashWord`/`buildSearchPrefix` with SubWire's own
 * (`appName = 'subwire'`, salt) identity and then confirmed against live QDN
 * search results on qortal-node-a, which returned real SubWire publications
 * whose identifiers begin with exactly this string (2026-09-13).
 */
const LIVE_VERIFIED_SUBWIRE_PREFIX = '7l1NGsWiY0SgPb-FJVWQM-T60ZadsfPsbLTh-';

/** A real SubWire article identifier published under the Shadow Archives name. */
const LIVE_SUBWIRE_ARTICLE_IDENTIFIER = '7l1NGsWiY0SgPb-FJVWQM-T60ZadsfPsbLTh-J1KcSHZWmB52mwv-v1';

describe('subwireArticleContract — identifier math', () => {
  it('derives the exact identifier prefix SubWire searches', async () => {
    await expect(subwireArticleIdentifierPrefix()).resolves.toBe(LIVE_VERIFIED_SUBWIRE_PREFIX);
  });

  it('derives a deterministic article identifier from the Shadow Archives id', async () => {
    const identifier = await subwireArticleIdentifier('abcdefghijkl');
    expect(identifier).toBe(`${LIVE_VERIFIED_SUBWIRE_PREFIX}abcdefghijkl-v1`);
    expect(identifier.length).toBeLessThanOrEqual(LIMITS.name);
    await expect(parseSubwireArticleIdentifier(identifier)).resolves.toBe('abcdefghijkl');
  });

  it('does not mistake a foreign SubWire publication for a Shadow Archives artifact', async () => {
    // A real SubWire article uses qapp-core's random 15-character unique id.
    await expect(
      parseSubwireArticleIdentifier(LIVE_SUBWIRE_ARTICLE_IDENTIFIER),
    ).resolves.toBeNull();
    await expect(parseSubwireArticleIdentifier(null)).resolves.toBeNull();
    await expect(parseSubwireArticleIdentifier('qtube_vid_abcdefghijkl')).resolves.toBeNull();
  });

  it('issues the same discovery request shape SubWire issues', () => {
    expect(SUBWIRE_ARTICLE_DISCOVERY_REQUEST).toMatchObject({
      action: 'SEARCH_QDN_RESOURCES',
      mode: 'ALL',
      service: 'DOCUMENT',
      prefix: true,
      reverse: true,
    });
  });
});

describe('subwireArticleContract — Core metadata truncation', () => {
  it('truncates by UTF-8 bytes without splitting a code point', () => {
    const text = 'õ'.repeat(100);
    const truncated = truncateUtf8Bytes(text, 75);
    expect(new TextEncoder().encode(truncated).length).toBeLessThanOrEqual(75);
    expect(truncated).toHaveLength(37);
    expect(truncated).toBe('õ'.repeat(37));
  });

  it('bounds title and description like SubWire does', () => {
    const long = 'a'.repeat(300);
    expect(subwireCoreTitle(long)).toHaveLength(75);
    expect(subwireCoreDescription(long)).toHaveLength(180);
    expect(subwireCoreTitle('  short  ')).toBe('short');
    expect(subwireCoreDescription('')).toBe('');
  });
});

describe('subwireArticleContract — derived article payload', () => {
  const document: RichTextDocument = {
    format: 'tiptap-json-v1',
    doc: {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Heading' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: 'Bold' },
            { type: 'text', text: ' and plain' },
          ],
        },
      ],
    },
  };

  it('builds the exact SubWire field set with an inline WebP cover', () => {
    const article = buildSubwireArticle({
      title: 'A post',
      excerpt: 'A summary',
      markdown: richTextToMarkdown(document),
      coverBase64: 'UklGRg==',
      coverFileName: 'saw-post-abcdefghijkl-cover.webp',
      timestamp: 1_700_000_000_000,
      publisherName: 'Shadow Archives',
    });

    expect(article).toEqual({
      title: 'A post',
      subtitle: 'A summary',
      content: '## Heading\n\n**Bold** and plain',
      coverImage: { name: 'saw-post-abcdefghijkl-cover.webp', src: 'UklGRg==' },
      timestamp: 1_700_000_000_000,
      name: 'Shadow Archives',
      type: 'essay',
      published: true,
    });
    expect(article).not.toHaveProperty('images');
    expect(article).not.toHaveProperty('media');
    expect(isSubwireRenderableArticle(article)).toBe(true);
  });

  it('omits an empty subtitle and rejects a payload SubWire could not render', () => {
    const article = buildSubwireArticle({
      title: 'A post',
      excerpt: '   ',
      markdown: 'Body',
      coverBase64: 'UklGRg==',
      coverFileName: 'cover.webp',
      timestamp: 1,
      publisherName: 'Shadow Archives',
    });
    expect(article).not.toHaveProperty('subtitle');
    expect(isSubwireRenderableArticle(article)).toBe(true);
    expect(isSubwireRenderableArticle({ ...article, content: '' })).toBe(false);
    expect(isSubwireRenderableArticle({ ...article, coverImage: { name: 'x', src: '' } })).toBe(
      false,
    );
    expect(isSubwireRenderableArticle({ ...article, published: false })).toBe(false);
    expect(isSubwireRenderableArticle(null)).toBe(false);
  });

  it('percent-encodes the publishing name in the SubWire deep link', () => {
    expect(subwireArticleUrl('Shadow Archives', 'abc-123')).toBe(
      'qortal://APP/Subwire/article/Shadow%20Archives/abc-123',
    );
  });
});
