import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';

import { siteConfig } from '../../app/config/siteConfig';
import { useCapability } from '../../app/providers/CapabilityProvider';
import { IconImage } from '../../components/common';
import { ListingGrid, Pagination, usePagedListings } from '../content';

/**
 * Owner controls live behind a dynamic import, so the TipTap editor, the cover
 * pipeline, the publish service, the SubWire adapter and the Quitter adapter are
 * fetched only for a verified owner and never ship in the visitor startup graph.
 * Non-owners render nothing at all here.
 */
const BlogOwnerPanel = lazy(() => import('./owner/BlogOwnerPanel'));

/** Paginated blog listing from validated catalog listings (no full-body fetches). */
export default function BlogPage() {
  const [params] = useSearchParams();
  const { isOwner } = useCapability();
  const requestedPage = Number(params.get('page') ?? '1');
  const { page, state } = usePagedListings(
    { type: 'blog-post' },
    requestedPage,
    siteConfig.pageSizes.blog,
  );

  return (
    <div className="sa-route">
      <header className="sa-route__header">
        <h1 className="sa-route__title">Blog</h1>
        <p className="sa-route__lead">
          Long-form posts published by Shadow Archives. Listings use catalog metadata; a post body
          is downloaded only on its own page.
        </p>
      </header>

      {isOwner ? (
        <Suspense fallback={null}>
          <BlogOwnerPanel />
        </Suspense>
      ) : null}

      <ListingGrid
        state={state}
        emptyTitle="No posts published yet"
        emptyDescription="No blog posts are available from the verified publisher scope."
        emptyIcon={<IconImage width={26} height={26} />}
        loadingCount={siteConfig.pageSizes.blog}
      />

      <Pagination
        page={page.page}
        pageCount={page.pageCount}
        hrefFor={(target) => (target > 1 ? `/blog?page=${target}` : '/blog')}
        label="Blog"
      />
    </div>
  );
}
