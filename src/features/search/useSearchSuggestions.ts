import { useMemo } from 'react';

import { useArchive, useListings } from '../content';
import type { CatalogListing } from '../../domain';

export interface SearchSuggestionState {
  readonly items: readonly CatalogListing[];
  /** True while the archive catalog itself is still loading (not per keystroke). */
  readonly loading: boolean;
}

/**
 * Live search suggestions from the already-loaded, validated catalog snapshot.
 *
 * Filtering is purely local (the shared `filterListings` path), so typing never
 * issues a QDN request. An empty query yields no suggestions, and the result is
 * capped to keep the dropdown compact.
 */
export function useSearchSuggestions(query: string, limit = 8): SearchSuggestionState {
  const trimmed = query.trim();
  const snapshot = useArchive();
  const matches = useListings({ query: trimmed });

  return useMemo(
    () => ({
      items: trimmed.length === 0 ? [] : matches.slice(0, limit),
      loading: snapshot.status === 'loading',
    }),
    [matches, trimmed, limit, snapshot.status],
  );
}
