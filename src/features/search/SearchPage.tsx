import { useSearchParams } from 'react-router-dom';

import { IconSearch } from '../../components/common';
import { ListingGrid, useListingState } from '../content';
import { ENTITY_KINDS, type EntityKind } from '../../domain';

function parseType(value: string | null): EntityKind | undefined {
  if (!value) return undefined;
  return (ENTITY_KINDS as readonly string[]).includes(value) ? (value as EntityKind) : undefined;
}

/**
 * Phase 2A search: simple local filtering over already-loaded, validated catalog
 * metadata. No QDN request is issued per keystroke, and full body text is not
 * fetched (the persisted full-text index remains a later bounded task).
 */
export default function SearchPage() {
  const [params] = useSearchParams();
  const query = params.get('q') ?? '';
  const type = parseType(params.get('type'));
  const state = useListingState({ query, type });

  return (
    <div className="sa-route">
      <header className="sa-route__header">
        <h1 className="sa-route__title">Search</h1>
        <p className="sa-route__lead">
          Results are filtered locally from the validated archive catalog. Search covers listing
          metadata (title, excerpt, slug, categories, tags); it does not fetch post bodies while you
          type.
        </p>
      </header>

      <p className="sa-detail__meta">
        Query: {query || '(empty)'} · Type: {type ?? 'all'}
      </p>

      <ListingGrid
        state={state}
        emptyTitle={query ? 'No matching content' : 'Enter a query'}
        emptyDescription="No validated catalog entries match this query."
        emptyIcon={<IconSearch width={26} height={26} />}
      />
    </div>
  );
}
