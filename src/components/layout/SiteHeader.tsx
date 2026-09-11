import { SiteBanner } from './SiteBanner';
import { TopListPanel } from './TopListPanel';

/**
 * Approved three-panel header. DOM order follows the Phase 1A spec
 * (top posts -> banner -> top videos); CSS grid places the panels left/right on
 * desktop and the mobile breakpoint reflows the banner first.
 */
export function SiteHeader() {
  return (
    <div className="sa-site-header__inner">
      <TopListPanel kind="posts" />
      <SiteBanner />
      <TopListPanel kind="videos" />
    </div>
  );
}
