import { SiteBanner } from './SiteBanner';

/**
 * Brand header. Phase 4 moved the Top Posts / Top Videos boxes out of the
 * header panel to a dedicated row directly below the banner (see `TopLists`),
 * so the header now holds only the banner artwork.
 */
export function SiteHeader() {
  return (
    <div className="sa-site-header__inner">
      <SiteBanner />
    </div>
  );
}
