import { describe, expect, it } from 'vitest';

import { siteConfig } from '../../app/config/siteConfig';
import {
  buildEntityIdentifier,
  validateEntityPayload,
  type ShadowArchiveEntity,
} from '../../domain';
import {
  TEST_BLOG_FIXTURE,
  TEST_ITEM_FIXTURE,
  TEST_VIDEO_FIXTURE,
} from '../../test/fixtures/content';
import {
  buildEngagementShareUrl,
  engagementItemFromCard,
  engagementItemFromEntity,
} from './engagementItem';

function entityFrom(fixture: unknown): ShadowArchiveEntity {
  const result = validateEntityPayload(fixture);
  if (!result.ok) throw new Error(`invalid fixture: ${result.message}`);
  return result.value;
}

describe('engagementItemFromEntity', () => {
  it('rebuilds the same full identifier and route a card would use for a blog post', () => {
    const post = entityFrom(TEST_BLOG_FIXTURE);
    expect(engagementItemFromEntity(post)).toEqual({
      entityIdentifier: buildEntityIdentifier('blog-post', post.id),
      kind: 'post',
      title: 'Redaction notes',
      sharePath: `/blog/${post.id}`,
    });
  });

  it('rebuilds the same full identifier and route a card would use for a video', () => {
    const video = entityFrom(TEST_VIDEO_FIXTURE);
    expect(engagementItemFromEntity(video)).toEqual({
      entityIdentifier: buildEntityIdentifier('video', video.id),
      kind: 'video',
      title: 'Field footage',
      sharePath: `/videos/${video.id}`,
    });
  });

  it('rebuilds the same full identifier and route a card would use for a gallery item', () => {
    const item = entityFrom(TEST_ITEM_FIXTURE);
    expect(engagementItemFromEntity(item)).toEqual({
      entityIdentifier: buildEntityIdentifier('gallery-item', item.id),
      kind: 'gallery',
      title: 'Plate 01',
      sharePath: `/gallery/item/${item.id}`,
    });
  });
});

describe('buildEngagementShareUrl', () => {
  const cardItem = engagementItemFromCard({
    id: 'saw_post_abcdefghijkl',
    kind: 'post',
    title: 'Redaction notes',
    href: '/blog/abcdefghijkl',
  });

  it('builds the canonical qortal://APP/<name>/<path> deep link', () => {
    expect(buildEngagementShareUrl(cardItem, 'Shadow Archives')).toBe(
      'qortal://APP/Shadow%20Archives/blog/abcdefghijkl',
    );
  });

  it('falls back to the configured app name outside a Qortal runtime', () => {
    expect(buildEngagementShareUrl(cardItem, null)).toBe(
      `qortal://APP/${encodeURIComponent(siteConfig.name)}/blog/abcdefghijkl`,
    );
  });

  it('never emits an http(s) user-facing link', () => {
    expect(buildEngagementShareUrl(cardItem, 'Shadow Archives')).not.toMatch(/^https?:\/\//);
  });
});
