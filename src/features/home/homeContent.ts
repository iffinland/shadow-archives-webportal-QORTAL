import { useListingState } from '../content/hooks';
import type { CollectionState, ContentCardModel } from '../../types/content';

/**
 * Latest-content data sources for the home route.
 *
 * Home consumes validated catalog listings from the archive repository. Listing
 * cards use catalog/thumbnail metadata only: home never fetches a blog body,
 * video bytes or a gallery original.
 */
export const HOME_PREVIEW_COUNT = 4;
export const GALLERY_STRIP_COUNT = 8;

export function useLatestPosts(): CollectionState<ContentCardModel> {
  return useListingState({ type: 'blog-post' }, HOME_PREVIEW_COUNT);
}

export function useLatestVideos(): CollectionState<ContentCardModel> {
  return useListingState({ type: 'video' }, HOME_PREVIEW_COUNT);
}

export function useLatestGalleryItems(): CollectionState<ContentCardModel> {
  return useListingState({ type: 'gallery-item' }, GALLERY_STRIP_COUNT);
}
