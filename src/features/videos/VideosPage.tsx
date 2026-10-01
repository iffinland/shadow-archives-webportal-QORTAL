import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';

import { siteConfig } from '../../app/config/siteConfig';
import { useCapability } from '../../app/providers/CapabilityProvider';
import { IconVideo } from '../../components/common';
import { ListingGrid, Pagination, usePagedListings } from '../content';

/**
 * Owner controls live behind a dynamic import, so the poster pipeline, the
 * publish service, the Q-Tube adapter and the publish modal are fetched only for
 * a verified owner and never ship in the visitor startup graph. Non-owners
 * render nothing at all here.
 */
const VideoOwnerPanel = lazy(() => import('./owner/VideoOwnerPanel'));

/** Paginated video listing. Listing cards use thumbnails only — no video bytes. */
export default function VideosPage() {
  const [params] = useSearchParams();
  const { isOwner } = useCapability();
  const requestedPage = Number(params.get('page') ?? '1');
  const { page, state } = usePagedListings(
    { type: 'video' },
    requestedPage,
    siteConfig.pageSizes.videos,
  );

  return (
    <div className="sa-route">
      <header className="sa-route__header">
        <h1 className="sa-route__title">Videos</h1>
        <p className="sa-route__lead">
          Videos published by Shadow Archives, browsed as posters first. A listing never downloads
          video bytes; open a video to play it.
        </p>
      </header>

      {isOwner ? (
        <Suspense fallback={null}>
          <VideoOwnerPanel />
        </Suspense>
      ) : null}

      <ListingGrid
        state={state}
        emptyTitle="No videos published yet"
        emptyDescription="No videos are available from the verified publisher scope."
        emptyIcon={<IconVideo width={26} height={26} />}
        loadingCount={4}
      />

      <Pagination
        page={page.page}
        pageCount={page.pageCount}
        hrefFor={(target) => (target > 1 ? `/videos?page=${target}` : '/videos')}
        label="Videos"
      />
    </div>
  );
}
