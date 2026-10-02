import { lazy, Suspense, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';

import { useCapability } from '../../app/providers/CapabilityProvider';
import { Button, IconImage } from '../../components/common';
import { resolveEntityReference } from '../../domain';
import { RouteLoading } from '../../components/feedback';
import {
  EntityStatePanel,
  ListingGrid,
  TaxonomyChips,
  formatDate,
  useArchive,
  useArchiveRefresh,
  useEntityDetail,
  useListings,
} from '../content';
import { collectionStateFromSnapshot, listingToCard } from '../content/listing/listingModel';

const GalleryAlbumEditModal = lazy(async () => ({
  default: (await import('./owner/GalleryAlbumModal')).GalleryAlbumModal,
}));

/**
 * Album detail: authoritative album entity plus its items from the loaded
 * catalog. Item membership is read from catalog metadata, so opening an album
 * never fetches every gallery item body.
 */
export default function GalleryAlbumPage() {
  const { id } = useParams<{ id: string }>();
  const { isOwner } = useCapability();
  const [editing, setEditing] = useState(false);
  const { status, entity, error, reload } = useEntityDetail('gallery-album', id ?? '');
  const album = entity && entity.kind === 'gallery-album' ? entity : null;

  const snapshot = useArchive();
  const refresh = useArchiveRefresh();
  const allItems = useListings({ type: 'gallery-item' });

  // Membership is stored as the bare stable id. The route may be opened with the
  // full `saw_album_<id>` alias, so normalise the route reference and prefer the
  // authoritative loaded album id.
  const routeAlbumId = resolveEntityReference('gallery-album', id ?? '') ?? id ?? '';

  const itemsState = useMemo(() => {
    const albumId = album?.id ?? routeAlbumId;
    const albumItems = allItems.filter((item) => item.albumId === albumId);
    return collectionStateFromSnapshot(snapshot, albumItems.map(listingToCard), refresh);
  }, [allItems, album?.id, routeAlbumId, snapshot, refresh]);

  const albumIndexUnavailable = snapshot.source === 'fallback' || snapshot.source === 'none';

  return (
    <div className="sa-route">
      <header className="sa-route__header">
        <h1 className="sa-route__title">{album ? album.data.title : 'Gallery album'}</h1>
        {album ? (
          <>
            <p className="sa-detail__meta">{formatDate(album.updatedAt) ?? 'Undated'}</p>
            <TaxonomyChips categories={album.data.categories} tags={album.data.tags} />
            {isOwner ? (
              <div className="sa-route__actions">
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Edit album
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="sa-route__lead">An album of archived media.</p>
        )}
      </header>

      {status === 'loading' ? <RouteLoading label="Loading album" /> : null}

      {status === 'ready' && album ? (
        <>
          {album.data.description ? (
            <p className="sa-detail__prose">{album.data.description}</p>
          ) : null}
          <h2 className="sa-route__title">Items</h2>
          <ListingGrid
            state={itemsState}
            emptyTitle="No album items available"
            emptyDescription={
              albumIndexUnavailable
                ? 'The catalog index is unavailable, so album membership cannot be resolved without fetching every item. No items are shown.'
                : 'This album has no published items in the catalog.'
            }
            emptyIcon={<IconImage width={26} height={26} />}
            loadingCount={6}
          />
        </>
      ) : null}

      {status !== 'loading' && status !== 'ready' ? (
        <EntityStatePanel
          status={status}
          subject="Gallery album"
          message={error?.message ?? undefined}
          onRetry={reload}
        />
      ) : null}
      {editing && album && isOwner ? (
        <Suspense fallback={null}>
          <GalleryAlbumEditModal
            onClose={() => setEditing(false)}
            initialDraft={{
              id: album.id,
              title: album.data.title,
              description: album.data.description,
              categories: album.data.categories,
              tags: album.data.tags,
              language: album.data.language,
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
