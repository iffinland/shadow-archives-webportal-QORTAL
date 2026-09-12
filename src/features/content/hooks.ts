import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useContent } from '../../app/providers/ContentProvider';
import { filterListings, loadEntityDetail, paginate, type PageResult } from '../../services';
import type { ArchiveSnapshot, DetailStatus } from '../../services/types';
import type { CatalogListing, EntityKind, ShadowArchiveEntity } from '../../domain';
import type { ContentError } from '../../services';
import type { CollectionState, ContentCardModel } from '../../types/content';
import { collectionStateFromSnapshot, listingToCard } from './listing/listingModel';

export interface ListingQuery {
  readonly type?: EntityKind;
  readonly category?: string | null;
  readonly tag?: string | null;
  readonly query?: string | null;
}

export function useArchive(): ArchiveSnapshot {
  return useContent().snapshot;
}

export function useArchiveRefresh(): () => void {
  return useContent().refresh;
}

/** Filtered, validated listings. Pure local filtering over the loaded snapshot. */
export function useListings(query: ListingQuery = {}): CatalogListing[] {
  const { listings } = useArchive();
  const { type, category, tag, query: text } = query;
  return useMemo(
    () => filterListings(listings, { type, category, tag, query: text }),
    [listings, type, category, tag, text],
  );
}

export interface PagedListings {
  readonly page: PageResult<CatalogListing>;
  readonly state: CollectionState<ContentCardModel>;
}

export function usePagedListings(
  query: ListingQuery,
  page: number,
  pageSize: number,
): PagedListings {
  const snapshot = useArchive();
  const refresh = useArchiveRefresh();
  const listings = useListings(query);

  return useMemo(() => {
    const paged = paginate(listings, page, pageSize);
    const cards = paged.items.map(listingToCard);
    return {
      page: paged,
      state: collectionStateFromSnapshot(snapshot, cards, refresh),
    };
  }, [listings, page, pageSize, snapshot, refresh]);
}

/** Card state for preview regions (home) with an optional item cap. */
export function useListingState(
  query: ListingQuery = {},
  limit?: number,
): CollectionState<ContentCardModel> {
  const snapshot = useArchive();
  const refresh = useArchiveRefresh();
  const { type, category, tag, query: text } = query;
  const listings = useListings({ type, category, tag, query: text });

  return useMemo(() => {
    const selected = limit === undefined ? listings : listings.slice(0, limit);
    return collectionStateFromSnapshot(snapshot, selected.map(listingToCard), refresh);
  }, [listings, limit, snapshot, refresh]);
}

export interface EntityDetailState {
  readonly status: DetailStatus | 'loading';
  readonly entity: ShadowArchiveEntity | null;
  readonly error: ContentError | null;
  readonly reload: () => void;
}

interface DetailRecord {
  readonly key: string;
  readonly status: DetailStatus | 'loading';
  readonly entity: ShadowArchiveEntity | null;
  readonly error: ContentError | null;
}

/**
 * Authoritative detail fetch for one route reference. The detail route is the
 * only place the full entity resource is downloaded.
 */
export function useEntityDetail(kind: EntityKind, reference: string): EntityDetailState {
  const { scope, reader } = useContent();
  const [nonce, setNonce] = useState(0);
  const requestKey = `${kind}:${reference}:${nonce}`;

  const [record, setRecord] = useState<DetailRecord>(() => ({
    key: requestKey,
    status: 'loading',
    entity: null,
    error: null,
  }));
  const current: DetailRecord =
    record.key === requestKey
      ? record
      : { key: requestKey, status: 'loading', entity: null, error: null };

  const loadIdRef = useRef(0);

  useEffect(() => {
    const id = loadIdRef.current + 1;
    loadIdRef.current = id;
    void loadEntityDetail(scope, kind, reference, { reader }).then((result) => {
      if (id !== loadIdRef.current) return;
      setRecord({
        key: requestKey,
        status: result.status,
        entity: result.entity,
        error: result.error,
      });
    });
    return () => {
      loadIdRef.current += 1;
    };
  }, [scope, reader, kind, reference, requestKey]);

  const reload = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  return { status: current.status, entity: current.entity, error: current.error, reload };
}
