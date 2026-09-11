import type { CollectionState, ContentCardModel } from '../../types/content';

/**
 * Latest-content data source for the home route.
 *
 * Phase 1B performs NO QDN discovery and ships NO mock network API. The state is
 * honestly `unavailable` until the catalog/discovery phase lands; the sections
 * render empty states with reserved geometry so swapping in real data later
 * causes no layout shift.
 */
const NOT_IMPLEMENTED_MESSAGE =
  'Content discovery arrives in a later phase; nothing is loaded from QDN yet.';

function unavailable<T>(): CollectionState<T> {
  return { status: 'unavailable', items: [], message: NOT_IMPLEMENTED_MESSAGE };
}

export function useLatestPosts(): CollectionState<ContentCardModel> {
  return unavailable<ContentCardModel>();
}

export function useLatestVideos(): CollectionState<ContentCardModel> {
  return unavailable<ContentCardModel>();
}

export function useLatestGalleryItems(): CollectionState<ContentCardModel> {
  return unavailable<ContentCardModel>();
}
