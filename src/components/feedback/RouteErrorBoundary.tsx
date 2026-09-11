import { isRouteErrorResponse, useRouteError } from 'react-router-dom';

import { siteConfig } from '../../app/config/siteConfig';
import { ErrorState } from './ErrorState';
import { IconWarning } from '../common/icons';

/**
 * Route-level error boundary rendered inside the shell, so navigation keeps
 * working when a single route fails.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();

  let title = 'This page could not be shown';
  let description =
    'The page failed while rendering. Other sections of the archive are still available.';

  if (isRouteErrorResponse(error)) {
    title = `${error.status} — ${error.statusText || title}`;
    description = error.data ? String(error.data) : description;
  } else if (error instanceof Error && error.message) {
    description = error.message;
  }

  return (
    <div className="sa-route">
      <ErrorState
        icon={<IconWarning />}
        title={title}
        description={description}
        onRetry={() => window.location.reload()}
        retryLabel="Reload"
      />
      <p className="sa-route__provenance">
        {siteConfig.name} · {siteConfig.phaseLabel} · v{siteConfig.version}
      </p>
    </div>
  );
}
