import { siteConfig } from '../../app/config/siteConfig';
import type { CollectionState, TopListEntry } from '../../types/content';

/**
 * Top Posts / Top Videos data source.
 *
 * Like-ranked lists require engagement reading, which is not implemented in
 * Phase 2A (likes are explicitly out of scope). The panel therefore reports an
 * honest `unavailable` state with an explicit reason instead of fabricating a
 * ranking or issuing like queries.
 *
 * `maxItems` comes from owner-editable config (owner decision: at most 10).
 */
export interface TopListState extends CollectionState<TopListEntry> {
  readonly maxItems: number;
}

const RANKING_UNAVAILABLE: Omit<TopListState, 'maxItems'> = {
  status: 'unavailable',
  items: [],
  message: 'Ranking unavailable until engagement data is implemented.',
};

export function useTopPosts(): TopListState {
  return { ...RANKING_UNAVAILABLE, maxItems: siteConfig.topList.maxItems };
}

export function useTopVideos(): TopListState {
  return { ...RANKING_UNAVAILABLE, maxItems: siteConfig.topList.maxItems };
}
