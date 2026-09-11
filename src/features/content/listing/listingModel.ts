import { routes } from '../../../app/config/navigation';
import { buildQdnResourcePath } from '../../../qortal';
import type { CatalogListing, EntityKind } from '../../../domain';
import type { ArchiveSnapshot } from '../../../services/types';
import type { CollectionState, ContentCardModel, ContentKind } from '../../../types/content';

export function listingHref(listing: CatalogListing): string {
  switch (listing.type) {
    case 'blog-post':
      return routes.blogDetail(listing.id);
    case 'video':
      return routes.videoDetail(listing.id);
    case 'gallery-album':
      return routes.galleryAlbum(listing.id);
    case 'gallery-item':
      return routes.galleryItem(listing.id);
  }
}

export function contentKindFor(listing: CatalogListing): ContentKind {
  if (listing.type === 'blog-post') return 'post';
  if (listing.type === 'video') return 'video';
  return 'gallery';
}

export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => value.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}

function defaultDimensions(type: EntityKind): { width: number; height: number } {
  if (type === 'gallery-item' || type === 'gallery-album') return { width: 4, height: 3 };
  return { width: 16, height: 9 };
}

/**
 * Build a card from a validated listing. Thumbnails only: a video card never
 * requests video bytes, and a gallery card never requests the original media.
 */
export function listingToCard(listing: CatalogListing): ContentCardModel {
  const fallbackDimensions = defaultDimensions(listing.type);
  const width = listing.width ?? fallbackDimensions.width;
  const height = listing.height ?? fallbackDimensions.height;
  const title = listing.title || 'Untitled';

  return {
    id: listing.identifier,
    kind: contentKindFor(listing),
    title,
    description: listing.excerpt || undefined,
    href: listingHref(listing),
    media: listing.thumbnail
      ? {
          src: buildQdnResourcePath({
            service: listing.thumbnail.service,
            name: listing.thumbnail.name,
            identifier: listing.thumbnail.identifier,
            path: listing.thumbnail.path ?? null,
          }),
          alt: title,
          width,
          height,
        }
      : undefined,
    durationLabel:
      listing.type === 'video' && listing.durationSeconds !== null
        ? formatDuration(listing.durationSeconds)
        : undefined,
    categories: listing.categories,
    tags: listing.tags,
  };
}

/**
 * Map the archive snapshot plus a filtered item set onto the shared collection
 * state machine. A failed or partial discovery is never reported as `empty`.
 */
export function collectionStateFromSnapshot<T>(
  snapshot: ArchiveSnapshot,
  items: readonly T[],
  onRetry?: () => void,
): CollectionState<T> {
  const shared = {
    partial: snapshot.partial,
    stale: snapshot.stale,
    source: snapshot.source,
    message: snapshot.message ?? undefined,
    onRetry,
  };

  switch (snapshot.status) {
    case 'loading':
      return { status: 'loading', items: [] };
    case 'ready':
      return { status: 'ready', items, ...shared };
    case 'stale':
      return { status: 'ready', items, ...shared };
    case 'empty':
      return { status: 'empty', items: [], ...shared };
    case 'partial':
      return items.length > 0
        ? { status: 'ready', items, ...shared }
        : { status: 'unavailable', items: [], ...shared };
    case 'unavailable':
      return { status: 'unavailable', items: [], ...shared };
    case 'error':
      return { status: 'error', items: [], ...shared };
  }
}

export function typeLabel(type: EntityKind): string {
  switch (type) {
    case 'blog-post':
      return 'Blog post';
    case 'video':
      return 'Video';
    case 'gallery-item':
      return 'Gallery item';
    case 'gallery-album':
      return 'Gallery album';
  }
}
