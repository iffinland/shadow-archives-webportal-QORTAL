import type { ReactNode } from 'react';

import { EmptyState } from '../../components/feedback';
import { ContentCardSkeleton, SkeletonGroup } from '../../components/common';
import { ContentCard } from '../home/components/ContentCard';
import { ListingNotice } from './listing/ListingNotice';
import type { CollectionState, ContentCardModel } from '../../types/content';

interface ListingGridProps {
  readonly state: CollectionState<ContentCardModel>;
  readonly emptyTitle: string;
  readonly emptyDescription: string;
  readonly emptyIcon?: ReactNode;
  readonly className?: string;
  /** Skeleton count while loading; matches the final grid geometry. */
  readonly loadingCount?: number;
}

/** Shared listing surface: cards when ready, an honest empty/error panel otherwise. */
export function ListingGrid({
  state,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  className,
  loadingCount = 4,
}: ListingGridProps) {
  if (state.status === 'loading') {
    return (
      <SkeletonGroup label="Loading archive results" className="sa-card-grid">
        {Array.from({ length: loadingCount }, (_, index) => (
          <ContentCardSkeleton key={index} />
        ))}
      </SkeletonGroup>
    );
  }

  if (state.status === 'ready' && state.items.length > 0) {
    return (
      <div className={['sa-listing', className].filter(Boolean).join(' ')}>
        <ListingNotice state={state} />
        <div className="sa-card-grid">
          {state.items.map((item) => (
            <ContentCard key={item.id} item={item} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <EmptyState
      icon={emptyIcon}
      title={state.status === 'error' ? `${emptyTitle} unavailable` : emptyTitle}
      description={state.message ?? emptyDescription}
    />
  );
}
