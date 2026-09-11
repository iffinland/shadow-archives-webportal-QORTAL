import { siteConfig } from '../../app/config/siteConfig';
import type { CollectionState, TopListEntry } from '../../types/content';

/**
 * Top Posts / Top Videos data source.
 *
 * Phase 1B deliberately performs NO QDN discovery: like-ranked lists require the
 * engagement + catalog phases, and showing fabricated "top" entries would
 * misrepresent production engagement. The hook returns an honest state and the
 * panel renders loading/empty presentation around it.
 *
 * `maxItems` comes from owner-editable config (owner decision: at most 10).
 */
export interface TopListState extends CollectionState<TopListEntry> {
  readonly maxItems: number;
}

const NOT_IMPLEMENTED: Omit<TopListState, 'maxItems'> = {
  status: 'unavailable',
  items: [],
  message: 'Like-ranked lists arrive with the engagement and catalog phases.',
};

export function useTopPosts(): TopListState {
  return { ...NOT_IMPLEMENTED, maxItems: siteConfig.topList.maxItems };
}

export function useTopVideos(): TopListState {
  return { ...NOT_IMPLEMENTED, maxItems: siteConfig.topList.maxItems };
}
