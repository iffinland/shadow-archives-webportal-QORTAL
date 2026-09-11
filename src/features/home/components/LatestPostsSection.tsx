import { routes } from '../../../app/config/navigation';
import { ContentCardSkeleton, IconImage, SkeletonGroup } from '../../../components/common';
import { EmptyState } from '../../../components/feedback';
import type { CollectionState, ContentCardModel } from '../../../types/content';
import { useLatestPosts } from '../homeContent';
import { ContentCard } from './ContentCard';
import { SectionHeader } from './SectionHeader';

interface LatestPostsSectionProps {
  /** Test seam; production reads the archive snapshot. */
  readonly state?: CollectionState<ContentCardModel>;
}

export function LatestPostsSection({ state }: LatestPostsSectionProps) {
  return state ? <LatestPostsView data={state} /> : <LatestPostsConnected />;
}

function LatestPostsConnected() {
  return <LatestPostsView data={useLatestPosts()} />;
}

function LatestPostsView({ data }: { readonly data: CollectionState<ContentCardModel> }) {
  const headingId = 'sa-latest-posts-heading';

  return (
    <section className="sa-section" aria-labelledby={headingId}>
      <SectionHeader
        id={headingId}
        title="Latest Posts"
        linkTo={routes.blog}
        linkLabel="All posts"
      />
      <div className="sa-section__body">
        {data.status === 'loading' ? (
          <SkeletonGroup label="Loading latest posts" className="sa-card-grid">
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
            icon={<IconImage width={26} height={26} />}
            title="No posts loaded"
            description={data.message ?? 'Nothing has been published yet.'}
          />
        )}
      </div>
    </section>
  );
}
