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

/**
 * Header side panel: like-ranked entries, maximum 10, no thumbnails, vertical
 * auto-scroll via the shared accessible mechanism.
 *
 * Phase 2A renders the honest unavailable presentation: like-ranked ordering
 * requires engagement reads, which are explicitly out of scope, so no ranking is
 * fabricated and no like query is issued.
 */
export function TopListPanel({ kind }: TopListPanelProps) {
  const topPosts = useTopPosts();
  const topVideos = useTopVideos();
  const state = kind === 'posts' ? topPosts : topVideos;
  const label = LABELS[kind];
  const headingId = `sa-top-${kind}-heading`;
  const items = state.items.slice(0, state.maxItems);

  return (
    <section className="sa-top-list" data-kind={kind} aria-labelledby={headingId}>
      <h2 className="sa-top-list__title" id={headingId}>
        {label}
      </h2>
      <div className="sa-top-list__body">
        {state.status === 'ready' && items.length > 0 ? (
          <AutoScrollTrack
            orientation="vertical"
            label={`${label} by likes`}
            itemCount={items.length}
            minItemsForScroll={siteConfig.topList.minItemsForScroll}
            className="sa-top-list__track"
          >
            <ol className="sa-top-list__items">
              {items.map((item, index) => (
                <li className="sa-top-list__item" key={item.id}>
                  <Link className="sa-top-list__link" to={item.href}>
                    <span className="sa-top-list__rank" aria-hidden="true">
                      {index + 1}
                    </span>
                    <span className="sa-top-list__text">{item.title}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </AutoScrollTrack>
        ) : state.status === 'loading' ? (
          <SkeletonGroup label={`Loading ${label}`} className="sa-top-list__skeleton">
            {[0, 1, 2, 3, 4].map((row) => (
              <Skeleton key={row} height={40} radius="var(--sa-radius-sm)" />
            ))}
          </SkeletonGroup>
        ) : (
          <EmptyState
            compact
            title={state.status === 'error' ? `${label} unavailable` : `No ranked ${kind} yet`}
            description={
              state.message ?? 'Ranked content appears once engagement data is available.'
            }
          />
        )}
      </div>
    </section>
  );
}
