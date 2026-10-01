import { Link } from 'react-router-dom';

import { IconImage, MediaFrame } from '../../../components/common';
import type { ContentCardModel } from '../../../types/content';
import { CardEngagementControls } from './CardEngagementControls';

interface ContentCardProps {
  readonly item: ContentCardModel;
}

/**
 * Content card geometry: thumbnail, title, short description and an engagement
 * footer row. Engagement controls use the item's exact QDN entity identifier;
 * their feedback is rendered beside the card action that initiated it.
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

      <CardEngagementControls item={item} />
    </article>
  );
}
