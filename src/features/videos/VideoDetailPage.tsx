import { useParams } from 'react-router-dom';

import { MediaFrame } from '../../components/common';
import { RouteLoading } from '../../components/feedback';
import { formatDurationLabel } from '../../domain/videoMedia';
import {
  EntityStatePanel,
  TaxonomyChips,
  formatDate,
  isImageService,
  mediaRefSrc,
  useEntityDetail,
} from '../content';

/**
 * Video detail with native playback.
 *
 * The authoritative entity stores the verified QDN media coordinate; the player
 * resolves it to the same-origin `/arbitrary/<service>/<name>/<identifier>` path
 * (no extra bridge round-trip). `preload="metadata"` means a detail visit never
 * downloads the whole file up front, and nothing autoplays. Listing cards still
 * never request video bytes.
 */
export default function VideoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { status, entity, error, reload } = useEntityDetail('video', id ?? '');
  const video = entity && entity.kind === 'video' ? entity : null;

  const posterSrc =
    video?.data.thumbnail && isImageService(video.data.thumbnail.service)
      ? mediaRefSrc(video.data.thumbnail)
      : null;
  const mediaSrc = video ? mediaRefSrc(video.data.media) : null;
  const playable = video !== null && video.data.media.service === 'VIDEO';

  return (
    <div className="sa-route">
      <header className="sa-route__header">
        <h1 className="sa-route__title">{video ? video.data.title : 'Video'}</h1>
        {video ? (
          <>
            <p className="sa-detail__meta">
              {formatDate(video.updatedAt) ?? 'Undated'}
              {video.data.durationSeconds > 0
                ? ` · ${formatDurationLabel(video.data.durationSeconds)}`
                : ''}
            </p>
            <TaxonomyChips categories={video.data.categories} tags={video.data.tags} />
          </>
        ) : (
          <p className="sa-route__lead">A single archived video and its stored metadata.</p>
        )}
      </header>

      {status === 'loading' ? <RouteLoading label="Loading video" /> : null}

      {status === 'ready' && video ? (
        <article className="sa-detail">
          {playable && mediaSrc ? (
            <div className="sa-detail__media">
              <video
                className="sa-video-player"
                src={mediaSrc}
                poster={posterSrc ?? undefined}
                controls
                preload="metadata"
                playsInline
                aria-label={`Play ${video.data.title}`}
              >
                Your browser cannot play this video. Use the media link below.
              </video>
              <p className="sa-field__hint">
                Media resource {video.data.media.service} {video.data.media.name}/
                {video.data.media.identifier}.{' '}
                <a href={mediaSrc} target="_blank" rel="noreferrer noopener">
                  Open the media file
                </a>
                .
              </p>
            </div>
          ) : posterSrc ? (
            <MediaFrame
              className="sa-detail__media"
              src={posterSrc}
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
                <dd>{formatDurationLabel(video.data.durationSeconds)}</dd>
              </div>
            ) : null}
          </dl>
          {!playable ? (
            <p className="sa-route__provenance">
              This entry references a {video.data.media.service} resource, which the built-in player
              cannot render. The stored reference is shown above.
            </p>
          ) : null}
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
