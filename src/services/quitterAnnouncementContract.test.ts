import { describe, expect, it } from 'vitest';

import {
  buildQuitterAnnouncementText,
  buildQuitterPost,
  isQuitterRenderablePost,
  parseQuitterPostIdentifier,
  quitterPostIdentifier,
  quitterPostIdentifierPrefix,
  shadowArchivesArticleUrl,
  QUITTER_POST_DISCOVERY_REQUEST,
  QUITTER_PUBLIC_SALT,
} from './quitterAnnouncementContract';

/**
 * Independently derived from qapp-core's identifier math with Quitter's own
 * (`appName = 'quitter'`, salt) identity, then confirmed against live QDN search
 * results on qortal-node-a, which returned real Quitter posts beginning with
 * exactly this prefix (2026-09-13).
 */
const LIVE_VERIFIED_QUITTER_PREFIX = 'MhNiRYdzkaP9dz-kX47dT-XrFXaYetyErMdF-';

describe('quitterAnnouncementContract — identity', () => {
  it('mirrors the identity current Quitter and SubWire both use', () => {
    // SubWire hardcodes this same app name and salt in `utils/quitterQdn.ts`.
    expect(QUITTER_PUBLIC_SALT).toBe('6hMqDBxky6j1G2wZEHgIiOeApj3x3CP8LQwg0Ok0RVc=');
  });

  it('derives the exact prefix Quitter searches for public posts', async () => {
    await expect(quitterPostIdentifierPrefix()).resolves.toBe(LIVE_VERIFIED_QUITTER_PREFIX);
  });

  it('derives a deterministic, recoverable post identifier', async () => {
    const identifier = await quitterPostIdentifier('abcdefghijkl');
    expect(identifier).toBe(`${LIVE_VERIFIED_QUITTER_PREFIX}abcdefghijkl-v1`);
    await expect(parseQuitterPostIdentifier(identifier)).resolves.toBe('abcdefghijkl');
  });

  it('rejects a foreign Quitter post identifier (random 15-character uid)', async () => {
    await expect(
      parseQuitterPostIdentifier(`${LIVE_VERIFIED_QUITTER_PREFIX}tmZfbRSFAhfvnav-v1`),
    ).resolves.toBeNull();
  });

  it('issues the same discovery request shape Quitter issues', () => {
    expect(QUITTER_POST_DISCOVERY_REQUEST).toMatchObject({
      action: 'SEARCH_QDN_RESOURCES',
      mode: 'ALL',
      service: 'DOCUMENT',
      prefix: true,
    });
  });
});

describe('quitterAnnouncementContract — announcement', () => {
  it('prefills title, excerpt and both article references', () => {
    const text = buildQuitterAnnouncementText({
      title: 'Uncovering the past',
      excerpt: 'Welcome to the Shadow Archives.',
      articleUrl: shadowArchivesArticleUrl('Shadow Archives', 'abcdefghijkl'),
      subwireUrl: 'qortal://APP/Subwire/article/Shadow%20Archives/abc-v1',
    });
    expect(text).toBe(
      [
        'New publication: Uncovering the past',
        '',
        'qortal://APP/Shadow%20Archives/blog/abcdefghijkl',
        'qortal://APP/Subwire/article/Shadow%20Archives/abc-v1',
        '',
        'Welcome to the Shadow Archives.',
      ].join('\n'),
    );
    // The references precede the excerpt so Quitter's 280-character collapsed
    // view still shows the article link (as SubWire's own share text does).
    expect(text.indexOf('qortal://')).toBeLessThan(text.indexOf('Welcome'));
    // Both references must be linkifiable by Quitter's bare-URL matcher, which
    // stops at the first whitespace character.
    for (const line of text.split('\n')) {
      if (line.startsWith('qortal://')) expect(line).not.toMatch(/\s/);
    }
  });

  it('omits the excerpt line when there is no excerpt', () => {
    expect(
      buildQuitterAnnouncementText({
        title: '  Title  ',
        excerpt: '   ',
        articleUrl: 'qortal://APP/Shadow%20Archives/blog/abcdefghijkl',
        subwireUrl: 'qortal://APP/Subwire/article/Shadow%20Archives/abc-v1',
      }),
    ).toContain('New publication: Title\n\nqortal://APP/Shadow%20Archives/blog/abcdefghijkl');
  });

  it('builds a Quitter payload with one embedded WebP image and no other fields', () => {
    const post = buildQuitterPost({
      text: 'New publication: A post',
      name: 'Shadow Archives',
      timestamp: 1_700_000_000_000,
      coverBase64: 'UklGRg==',
    });
    expect(post).toEqual({
      text: 'New publication: A post',
      timestamp: 1_700_000_000_000,
      name: 'Shadow Archives',
      images: [{ src: 'UklGRg==' }],
    });
    expect(isQuitterRenderablePost(post)).toBe(true);
  });

  it('omits the image entirely for a text-only announcement', () => {
    const post = buildQuitterPost({
      text: 'New publication: A post',
      name: 'Shadow Archives',
      timestamp: 1,
      coverBase64: null,
    });
    expect(post).not.toHaveProperty('images');
    expect(isQuitterRenderablePost(post)).toBe(true);
    expect(isQuitterRenderablePost({ ...post, text: '  ' })).toBe(false);
    expect(isQuitterRenderablePost({ ...post, images: [{ src: '' }] })).toBe(false);
    expect(
      isQuitterRenderablePost({ ...post, images: [{ src: 'a' }, { src: 'b' }, { src: 'c' }] }),
    ).toBe(false);
  });

  it('percent-encodes the Shadow Archives article link', () => {
    expect(shadowArchivesArticleUrl('Shadow Archives', 'abcdefghijkl')).toBe(
      'qortal://APP/Shadow%20Archives/blog/abcdefghijkl',
    );
  });
});
