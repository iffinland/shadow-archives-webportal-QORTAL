import { useMemo } from 'react';

import { siteConfig } from '../../app/config/siteConfig';
import { useListingState } from '../content/hooks';
import type { CollectionState, ContentCardModel, TopListEntry } from '../../types/content';

/**
 * Top Posts / Top Videos data source.
 *
 * Phase 4 replaces the previous like-ranked placeholder with the latest archive
 * items. Both panels read the already-loaded, validated catalog snapshot through
 * the shared content hooks: no new QDN search, no polling and no engagement
 * read is issued for this feature. The snapshot is ordered latest-first
 * (`updatedAt` desc) by the read pipeline, so "latest N" is a bounded slice of
 * that existing order.
 *
 * `maxItems` comes from owner-editable config (Phase 4 decision: 6).
 */
export interface TopListState extends CollectionState<TopListEntry> {
  readonly maxItems: number;
}

/** Map validated listing cards to the minimal title-only ticker entry. */
export function toTopEntries(cards: readonly ContentCardModel[], limit: number): TopListEntry[] {
  return cards
    .slice(0, Math.max(0, limit))
    .map((card) => ({ id: card.id, title: card.title, href: card.href }));
}

function useLatestTopList(type: 'blog-post' | 'video'): TopListState {
  const limit = siteConfig.topList.maxItems;
  const state = useListingState({ type }, limit);
  return useMemo(
    () => ({ ...state, items: toTopEntries(state.items, limit), maxItems: limit }),
    [state, limit],
  );
}

export function useTopPosts(): TopListState {
  return useLatestTopList('blog-post');
}

export function useTopVideos(): TopListState {
  return useLatestTopList('video');
}
