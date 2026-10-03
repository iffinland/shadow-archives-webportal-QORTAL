import { Link } from 'react-router-dom';

import { siteConfig } from '../../app/config/siteConfig';
import { useTopPosts, useTopVideos } from '../../features/engagement/topContent';
import { AutoScrollTrack, Skeleton, SkeletonGroup } from '../common';
import { EmptyState } from '../feedback';

export type TopListKind = 'posts' | 'videos';

interface TopListPanelProps {
  readonly kind: TopListKind;
}

const LABELS: Record<TopListKind, string> = { posts: 'Top Posts', videos: 'Top Videos' };
const EMPTY_TITLE: Record<TopListKind, string> = { posts: 'No posts yet', videos: 'No videos yet' };
const EMPTY_COPY: Record<TopListKind, string> = {
  posts: 'No posts have been catalogued yet.',
  videos: 'No videos have been catalogued yet.',
};

/**
 * Top Posts / Top Videos box: the latest archive titles only, scrolled
 * continuously upward by the shared `AutoScrollTrack`.
 *
 * The visible labels keep their original names even though the ordering is now
 * latest-first rather than an engagement ranking. Each title is a real in-app
 * link; the duplicated loop copy is `aria-hidden`/`inert` and never announced
 * twice. No thumbnails, descriptions, metadata, icons or cards are rendered.
 */
export function TopListPanel({ kind }: TopListPanelProps) {
  const topPosts = useTopPosts();
  const topVideos = useTopVideos();
  const state = kind === 'posts' ? topPosts : topVideos;
  const label = LABELS[kind];
  const headingId = `sa-top-${kind}-heading`;
  const items = state.items.slice(0, state.maxItems);
  const isReady = state.status === 'ready' && items.length > 0;

  return (
    <section className="sa-top-list" data-kind={kind} aria-labelledby={headingId}>
      <h2 className="sa-top-list__title" id={headingId}>
        {label}
      </h2>
      <div className="sa-top-list__body">
        {isReady ? (
          <AutoScrollTrack
            orientation="vertical"
            label={`${label} ticker`}
            itemCount={items.length}
            minItemsForScroll={siteConfig.topList.minItemsForScroll}
            className="sa-top-list__track"
          >
            <ol className="sa-top-list__items">
              {items.map((item) => (
                <li className="sa-top-list__item" key={item.id}>
                  <Link className="sa-top-list__link" to={item.href}>
                    <span className="sa-top-list__text">{item.title}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </AutoScrollTrack>
        ) : state.status === 'loading' ? (
          <SkeletonGroup label={`Loading ${label}`} className="sa-top-list__skeleton">
            {[0, 1].map((row) => (
              <Skeleton key={row} height={40} radius="var(--sa-radius-sm)" />
            ))}
          </SkeletonGroup>
        ) : (
          <EmptyState
            compact
            title={state.status === 'error' ? `${label} unavailable` : EMPTY_TITLE[kind]}
            description={state.message ?? EMPTY_COPY[kind]}
          />
        )}
      </div>
    </section>
  );
}
