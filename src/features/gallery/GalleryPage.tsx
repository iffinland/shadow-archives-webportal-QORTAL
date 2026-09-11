import { IconImage } from '../../components/common';
import { ListingGrid, useListingState } from '../content';

/** Albums plus recent items. Listings never download gallery originals. */
export default function GalleryPage() {
  const albums = useListingState({ type: 'gallery-album' });
  const items = useListingState({ type: 'gallery-item' }, 12);

  return (
    <div className="sa-route">
      <header className="sa-route__header">
        <h1 className="sa-route__title">Gallery</h1>
        <p className="sa-route__lead">
          Archive media, browsed as thumbnails first. Original media is never downloaded for a
          listing.
        </p>
      </header>

      <div className="sa-detail">
        <h2 className="sa-route__title">Albums</h2>
        <ListingGrid
          state={albums}
          emptyTitle="No albums published yet"
          emptyDescription="No gallery albums are available from the verified publisher scope."
          emptyIcon={<IconImage width={26} height={26} />}
          loadingCount={3}
        />
      </div>

      <div className="sa-detail">
        <h2 className="sa-route__title">Recent items</h2>
        <ListingGrid
          state={items}
          emptyTitle="No gallery items yet"
          emptyDescription="No gallery items are available from the verified publisher scope."
          emptyIcon={<IconImage width={26} height={26} />}
          loadingCount={6}
        />
      </div>
    </div>
  );
}
