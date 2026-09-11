import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { AppProviders } from '../app/providers';
import { appRoutes } from '../app/router/routes';
import type { QdnEnvironment, QortalAccount } from '../qortal/types';

interface RenderAppOptions {
  readonly route?: string;
  /** Inject a synthetic QDN environment instead of reading the global window. */
  readonly environment?: QdnEnvironment;
  /** Preseed an account; authentication is never triggered automatically. */
  readonly initialAccount?: QortalAccount | null;
}

/** Render the real route table in a memory router (basename '/'). */
export function renderApp({ route = '/', environment, initialAccount }: RenderAppOptions = {}) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [route] });
  const utils = render(
    <AppProviders environment={environment} initialAccount={initialAccount}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return { ...utils, router };
}
