/**
 * Minimal descriptor the shared engagement quick actions operate on.
 *
 * Both the card view model (`ContentCardModel`) and the authoritative detail
 * entities resolve to this same shape, so Blog/Video/Gallery cards and their
 * full detail pages run one implementation and target the exact same canonical
 * entity identifier.
 */

import { routes } from '../../app/config/navigation';
import { siteConfig } from '../../app/config/siteConfig';
import { buildEntityIdentifier, type EntityKind, type ShadowArchiveEntity } from '../../domain';
import { buildQortalAppUrl } from '../../qortal';
import type { ContentCardModel, ContentKind } from '../../types/content';

export interface EngagementItem {
  /** Full canonical entity identifier, e.g. `saw_post_<id12>`. */
  readonly entityIdentifier: string;
  readonly kind: ContentKind;
  readonly title: string;
  /** In-app route path; the Share action turns it into a canonical Qortal link. */
  readonly sharePath: string;
}

const CONTENT_KIND_BY_ENTITY_KIND: Readonly<Record<EntityKind, ContentKind>> = {
  'blog-post': 'post',
  video: 'video',
  'gallery-item': 'gallery',
  'gallery-album': 'gallery',
};

/** Canonical in-app route path for an entity detail view. */
export function entityQuickActionPath(kind: EntityKind, id: string): string {
  switch (kind) {
    case 'blog-post':
      return routes.blogDetail(id);
    case 'video':
      return routes.videoDetail(id);
    case 'gallery-item':
      return routes.galleryItem(id);
    case 'gallery-album':
      return routes.galleryAlbum(id);
  }
}

/**
 * Build the engagement descriptor from an authoritative detail entity.
 *
 * The card path carries the full identifier (`listing.identifier`); the entity
 * envelope carries the bare stable id, so it is rebuilt here to keep card and
 * detail actions pointed at the same QDN resource namespace.
 */
export function engagementItemFromEntity(entity: ShadowArchiveEntity): EngagementItem {
  return {
    entityIdentifier: buildEntityIdentifier(entity.kind, entity.id),
    kind: CONTENT_KIND_BY_ENTITY_KIND[entity.kind],
    title: entity.data.title,
    sharePath: entityQuickActionPath(entity.kind, entity.id),
  };
}

export function engagementItemFromCard(item: ContentCardModel): EngagementItem {
  return {
    entityIdentifier: item.id,
    kind: item.kind,
    title: item.title,
    sharePath: item.href,
  };
}

/**
 * Canonical Qortal deep link for an item: `qortal://APP/<app>/<path>`.
 *
 * The published app name comes from the injected runtime identity; the
 * owner-editable `siteConfig.name` is only the plain-browser/dev fallback.
 * Internal node/API HTTP URLs are deliberately not affected by this helper.
 */
export function buildEngagementShareUrl(
  item: EngagementItem,
  publisherName: string | null,
): string {
  const appName = publisherName?.trim() || siteConfig.name;
  return buildQortalAppUrl(appName, item.sharePath);
}
