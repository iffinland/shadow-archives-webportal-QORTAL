import { Link } from 'react-router-dom';

import {
  AutoScrollTrack,
  IconImage,
  MediaFrame,
  Skeleton,
  SkeletonGroup,
} from '../../../components/common';
import { EmptyState } from '../../../components/feedback';
import { routes } from '../../../app/config/navigation';
import type { CollectionState, ContentCardModel } from '../../../types/content';
import { useLatestGalleryItems } from '../homeContent';
import { SectionHeader } from './SectionHeader';

interface GalleryStripProps {
  /** Test seam; production uses the (currently unavailable) discovery hook. */
  readonly state?: CollectionState<ContentCardModel>;
}

/**
 * `LATEST FROM THE GALLERY` — the responsive horizontal strip foundation.
 * Auto-scroll is an enhancement: with no content (Phase 1B) or with reduced
 * motion the strip is a plain, natively scrollable region.
 */
export function GalleryStrip({ state }: GalleryStripProps) {
  const discovered = useLatestGalleryItems();
  const data = state ?? discovered;
  const headingId = 'sa-gallery-strip-heading';

  return (
    <section className="sa-gallery" aria-labelledby={headingId}>
      <SectionHeader
        id={headingId}
        title="Latest from the Gallery"
        linkTo={routes.gallery}
        linkLabel="All media"
      />
      <div className="sa-gallery__body">
        {data.status === 'loading' ? (
          <SkeletonGroup label="Loading gallery strip" className="sa-gallery__track">
            {[0, 1, 2, 3, 4, 5].map((tile) => (
              <Skeleton key={tile} className="sa-gallery__tile" />
            ))}
          </SkeletonGroup>
        ) : data.status === 'ready' && data.items.length > 0 ? (
          <AutoScrollTrack
            orientation="horizontal"
            label="Latest gallery media"
            itemCount={data.items.length}
            minItemsForScroll={4}
            className="sa-gallery__track"
          >
            <ul className="sa-gallery__items">
              {data.items.map((item) => (
                <li className="sa-gallery__item" key={item.id}>
                  <Link className="sa-gallery__link" to={item.href}>
                    <MediaFrame
                      className="sa-gallery__tile"
                      src={item.media?.src}
                      alt={item.media?.alt ?? item.title}
                      width={item.media?.width ?? 4}
                      height={item.media?.height ?? 3}
                      fallback={
                        <span className="sa-gallery__fallback">
                          <IconImage width={24} height={24} />
                        </span>
                      }
                    />
                    <span className="sa-gallery__caption">{item.title}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </AutoScrollTrack>
        ) : (
          <EmptyState
            compact
            icon={<IconImage width={24} height={24} />}
            title="No gallery media loaded"
            description={data.message ?? 'Gallery discovery arrives with the catalog phase.'}
          />
        )}
      </div>
    </section>
  );
}
