import { useParams } from 'react-router-dom';

import { MediaFrame } from '../../components/common';
import { RouteLoading } from '../../components/feedback';
import {
  EntityStatePanel,
  TaxonomyChips,
  formatDate,
  isImageService,
  mediaRefSrc,
  useEntityDetail,
} from '../content';

/**
 * Video detail.
 *
 * Phase 2A intentionally does NOT implement a player. The authoritative metadata
 * entity is fetched and the verified QDN media reference is exposed so a future
 * adapter can map it, but no video bytes are requested and no player library is
 * introduced.
 */
export default function VideoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { status, entity, error, reload } = useEntityDetail('video', id ?? '');
  const video = entity && entity.kind === 'video' ? entity : null;

  return (
    <div className="sa-route">
      <header className="sa-route__header">
        <h1 className="sa-route__title">{video ? video.data.title : 'Video'}</h1>
        {video ? (
          <>
            <p className="sa-detail__meta">{formatDate(video.updatedAt) ?? 'Undated'}</p>
            <TaxonomyChips categories={video.data.categories} tags={video.data.tags} />
          </>
        ) : (
          <p className="sa-route__lead">A single archived video and its stored metadata.</p>
        )}
      </header>

      {status === 'loading' ? <RouteLoading label="Loading video" /> : null}

      {status === 'ready' && video ? (
        <article className="sa-detail">
          {video.data.thumbnail && isImageService(video.data.thumbnail.service) ? (
            <MediaFrame
              className="sa-detail__media"
              src={mediaRefSrc(video.data.thumbnail)}
              alt={video.data.title}
              width={16}
              height={9}
            />
          ) : null}
          {video.data.description ? (
            <p className="sa-detail__prose">{video.data.description}</p>
          ) : null}
          <dl className="sa-route__details">
            <div className="sa-route__detail">
              <dt>Media service</dt>
              <dd>{video.data.media.service}</dd>
            </div>
            <div className="sa-route__detail">
              <dt>Media resource</dt>
              <dd>
                {video.data.media.name}/{video.data.media.identifier}
              </dd>
            </div>
            {video.data.durationSeconds > 0 ? (
              <div className="sa-route__detail">
                <dt>Duration</dt>
                <dd>{Math.round(video.data.durationSeconds)}s</dd>
              </div>
            ) : null}
          </dl>
          <p className="sa-route__provenance">
            Media playback is not implemented in this phase; no video bytes were requested.
          </p>
        </article>
      ) : null}

      {status !== 'loading' && status !== 'ready' ? (
        <EntityStatePanel
          status={status}
          subject="Video"
          message={error?.message ?? undefined}
          onRetry={reload}
        />
      ) : null}
    </div>
  );
}
