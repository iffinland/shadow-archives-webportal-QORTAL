import { lazy, Suspense, useState } from 'react';
import { useParams } from 'react-router-dom';

import { useCapability } from '../../app/providers/CapabilityProvider';
import { MediaFrame } from '../../components/common';
import { Button } from '../../components/common';
import { RouteLoading } from '../../components/feedback';
import {
  EntityStatePanel,
  TaxonomyChips,
  formatDate,
  isImageService,
  mediaRefSrc,
  typeKindLabel,
  useEntityDetail,
} from '../content';

const GalleryImageEditModal = lazy(async () => ({
  default: (await import('./owner/GalleryImageModal')).GalleryImageModal,
}));

/** Gallery item detail: authoritative entity plus its thumbnail/media dimensions. */
export default function GalleryItemPage() {
  const { id } = useParams<{ id: string }>();
  const { isOwner } = useCapability();
  const [editing, setEditing] = useState(false);
  const { status, entity, error, reload } = useEntityDetail('gallery-item', id ?? '');
  const item = entity && entity.kind === 'gallery-item' ? entity : null;

  const displayRef = item
    ? isImageService(item.data.media.service)
      ? item.data.media
      : item.data.thumbnail && isImageService(item.data.thumbnail.service)
        ? item.data.thumbnail
        : null
    : null;

  return (
    <div className="sa-route">
      <header className="sa-route__header">
        <h1 className="sa-route__title">{item ? item.data.title : 'Gallery item'}</h1>
        {item ? (
          <>
            <p className="sa-detail__meta">{formatDate(item.updatedAt) ?? 'Undated'}</p>
            <TaxonomyChips categories={item.data.categories} tags={item.data.tags} />
            {isOwner ? (
              <div className="sa-route__actions">
                <Button variant="secondary" onClick={() => setEditing(true)}>
                  Edit image
                </Button>
              </div>
            ) : null}
          </>
        ) : (
          <p className="sa-route__lead">A single archived media item.</p>
        )}
      </header>

      {status === 'loading' ? <RouteLoading label="Loading item" /> : null}

      {status === 'ready' && item ? (
        <article className="sa-detail">
          {displayRef ? (
            <MediaFrame
              className="sa-detail__media"
              src={mediaRefSrc(displayRef)}
              alt={item.data.title}
              width={item.data.width || 4}
              height={item.data.height || 3}
            />
          ) : (
            <p className="sa-route__provenance">
              No displayable still image for this item; the stored media is a{' '}
              {typeKindLabel(item.kind)} reference of service {item.data.media.service}.
            </p>
          )}
          {item.data.description ? (
            <p className="sa-detail__prose">{item.data.description}</p>
          ) : null}
          <p className="sa-route__provenance">
            Dimensions reserved {item.data.width || 'auto'}×{item.data.height || 'auto'}; the
            original media is not downloaded for listing pages.
          </p>
        </article>
      ) : null}

      {status !== 'loading' && status !== 'ready' ? (
        <EntityStatePanel
          status={status}
          subject="Gallery item"
          message={error?.message ?? undefined}
          onRetry={reload}
        />
      ) : null}
      {editing && item && isOwner ? (
        <Suspense fallback={null}>
          <GalleryImageEditModal
            onClose={() => setEditing(false)}
            initialDraft={{
              id: item.id,
              title: item.data.title,
              description: item.data.description,
              albumId: item.data.albumId,
              categories: item.data.categories,
              tags: item.data.tags,
              language: item.data.language,
            }}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
