import { routes } from '../../../app/config/navigation';
import { ContentCardSkeleton, IconVideo, SkeletonGroup } from '../../../components/common';
import { EmptyState } from '../../../components/feedback';
import type { CollectionState, ContentCardModel } from '../../../types/content';
import { useLatestVideos } from '../homeContent';
import { ContentCard } from './ContentCard';
import { SectionHeader } from './SectionHeader';

interface LatestVideosSectionProps {
  /** Test seam; production reads the archive snapshot. */
  readonly state?: CollectionState<ContentCardModel>;
}

export function LatestVideosSection({ state }: LatestVideosSectionProps) {
  return state ? <LatestVideosView data={state} /> : <LatestVideosConnected />;
}

function LatestVideosConnected() {
  return <LatestVideosView data={useLatestVideos()} />;
}

function LatestVideosView({ data }: { readonly data: CollectionState<ContentCardModel> }) {
  const headingId = 'sa-latest-videos-heading';

  return (
    <section className="sa-section" aria-labelledby={headingId}>
      <SectionHeader
        id={headingId}
        title="Latest Videos"
        linkTo={routes.videos}
        linkLabel="All videos"
      />
      <div className="sa-section__body">
        {data.status === 'loading' ? (
          <SkeletonGroup label="Loading latest videos" className="sa-card-grid">
            <ContentCardSkeleton />
            <ContentCardSkeleton />
          </SkeletonGroup>
        ) : data.status === 'ready' && data.items.length > 0 ? (
          <div className="sa-card-grid">
            {data.items.map((item) => (
              <ContentCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<IconVideo width={26} height={26} />}
            title="No videos loaded"
            description={data.message ?? 'Video discovery arrives with the archive phase.'}
          />
        )}
      </div>
    </section>
  );
}
