import { Link } from 'react-router-dom';

import {
  IconComment,
  IconImage,
  IconShare,
  IconThumbsUp,
  IconTip,
  MediaFrame,
} from '../../../components/common';
import type { ContentCardModel } from '../../../types/content';

interface ContentCardProps {
  readonly item: ContentCardModel;
}

/**
 * Content card geometry: thumbnail, title, short description and an engagement
 * footer row.
 *
 * Phase 1B reserves the footer geometry but exposes no engagement controls —
 * the row is `aria-hidden` because it contains no working interaction yet, and
 * no like/comment counts are fabricated.
 */
export function ContentCard({ item }: ContentCardProps) {
  return (
    <article className="sa-card">
      <Link className="sa-card__media-link" to={item.href} tabIndex={-1} aria-hidden="true">
        {item.media ? (
          <MediaFrame
            className="sa-card__media"
            src={item.media.src}
            alt={item.media.alt}
            width={item.media.width}
            height={item.media.height}
          />
        ) : (
          <span className="sa-card__media sa-card__media--empty">
            <IconImage width={28} height={28} />
          </span>
        )}
        {item.durationLabel ? <span className="sa-card__badge">{item.durationLabel}</span> : null}
      </Link>

      <div className="sa-card__body">
        <h3 className="sa-card__title">
          <Link className="sa-card__title-link" to={item.href}>
            {item.title}
          </Link>
        </h3>
        {item.description ? <p className="sa-card__description">{item.description}</p> : null}
      </div>

      <div className="sa-card__actions" aria-hidden="true">
        <span className="sa-card__action">
          <IconThumbsUp />
        </span>
        <span className="sa-card__action">
          <IconComment />
        </span>
        <span className="sa-card__action">
          <IconShare />
        </span>
        <span className="sa-card__action">
          <IconTip />
        </span>
      </div>
    </article>
  );
}
