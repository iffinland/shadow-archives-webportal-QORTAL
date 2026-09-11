import type { CollectionState } from '../../../types/content';

interface ListingNoticeProps {
  readonly state: CollectionState<unknown>;
}

/**
 * Honest caveat above a listing grid. Only rendered when the data is usable but
 * its completeness or freshness cannot be guaranteed.
 */
export function ListingNotice({ state }: ListingNoticeProps) {
  if (state.status !== 'ready' || state.items.length === 0) return null;
  if (!state.message) return null;
  if (!state.partial && !state.stale && state.source !== 'fallback') return null;

  return (
    <p className="sa-listing__notice" role="status">
      {state.message}
    </p>
  );
}
