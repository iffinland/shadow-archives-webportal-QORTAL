import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';

import { RouteLoading } from '../feedback';
import { PrimaryActions } from './PrimaryActions';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';
import { SiteNav } from './SiteNav';

/**
 * Persistent application shell: header, primary actions, site navigation,
 * route outlet and footer.
 *
 * Home-only regions (Latest Posts / Latest Videos / gallery strip) live in the
 * home route so other routes do not pay for them (Phase 1A §3).
 * The route outlet is wrapped in a layout-stable Suspense boundary so lazy
 * route modules never unmount the shell.
 */
export function AppShell() {
  return (
    <div className="sa-shell">
      <a className="sa-skip-link" href="#sa-main">
        Skip to content
      </a>
      <header className="sa-site-header">
        <SiteHeader />
      </header>
      <PrimaryActions />
      <SiteNav />
      <main id="sa-main" className="sa-main" tabIndex={-1}>
        <Suspense fallback={<RouteLoading />}>
          <Outlet />
        </Suspense>
      </main>
      <SiteFooter />
    </div>
  );
}
