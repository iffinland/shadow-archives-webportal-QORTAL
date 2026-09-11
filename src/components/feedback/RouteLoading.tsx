import { ContentCardSkeleton, Skeleton, SkeletonGroup } from '../common/Skeleton';

/**
 * Route-level Suspense fallback. Reserves the same geometry as a loaded route
 * (section heading + card grid) so lazy loading does not shift layout.
 */
export function RouteLoading({ label = 'Loading page' }: { label?: string }) {
  return (
    <div className="sa-route">
      <SkeletonGroup label={label} className="sa-route__loading">
        <Skeleton height={32} width={280} />
        <Skeleton height={16} width={420} />
        <div className="sa-card-grid sa-card-grid--2">
          <ContentCardSkeleton />
          <ContentCardSkeleton />
          <ContentCardSkeleton />
          <ContentCardSkeleton />
        </div>
      </SkeletonGroup>
    </div>
  );
}
