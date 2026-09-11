import { useSearchParams } from 'react-router-dom';

import { siteConfig } from '../../app/config/siteConfig';
import { IconVideo } from '../../components/common';
import { ListingGrid, Pagination, usePagedListings } from '../content';

/** Paginated video listing. Video cards use thumbnails only — no video bytes. */
export default function VideosPage() {
  const [params] = useSearchParams();
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
          Videos published by Shadow Archives. Listing cards never request video bytes, and playback
          is not implemented in this phase.
        </p>
      </header>

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
