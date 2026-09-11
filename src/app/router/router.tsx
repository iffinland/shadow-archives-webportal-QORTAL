import { createBrowserRouter } from 'react-router-dom';

import { getRouterBasename } from '../../qortal/environment';
import { appRoutes } from './routes';

/**
 * Browser router with the QDN basename.
 *
 * `_qdnBase` is injected by Core for an `APP` resource whose route is
 * auto-served from `index.html`; it is empty in a plain browser and in the node
 * dev proxy, where the app is served from the origin root. `HashRouter` is
 * deliberately not used.
 */
export function createAppRouter() {
  return createBrowserRouter(appRoutes, { basename: getRouterBasename() });
}
