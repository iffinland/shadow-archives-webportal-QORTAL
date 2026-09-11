import { useState } from 'react';
import { Link } from 'react-router-dom';

import bannerUrl from '../../assets/banner-shadow-archives.webp';
import { siteConfig } from '../../app/config/siteConfig';

/**
 * Brand banner. The real owner-supplied artwork is shown in a fixed,
 * aspect-bounded box (CSS) so the 16:9 source never dictates desktop header
 * height. If the image fails, the textual wordmark is the fallback — never an
 * empty box.
 */
export function SiteBanner() {
  const [imageFailed, setImageFailed] = useState(false);

  return (
    <div className="sa-banner" data-image-failed={imageFailed ? 'true' : 'false'}>
      <Link className="sa-banner__link" to="/" aria-label={`${siteConfig.name} — home`}>
        {imageFailed ? (
          <span className="sa-banner__fallback">{siteConfig.name}</span>
        ) : (
          <img
            className="sa-banner__image"
            src={bannerUrl}
            alt=""
            width={1202}
            height={683}
            decoding="async"
            fetchPriority="high"
            onError={() => setImageFailed(true)}
          />
        )}
      </Link>
    </div>
  );
}
