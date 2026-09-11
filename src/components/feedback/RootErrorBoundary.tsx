import { Component, type ErrorInfo, type ReactNode } from 'react';

import { siteConfig } from '../../app/config/siteConfig';
import { Button } from '../common/Button';
import { IconWarning } from '../common/icons';

interface RootErrorBoundaryProps {
  readonly children: ReactNode;
}

interface RootErrorBoundaryState {
  readonly error: Error | null;
}

/**
 * Top-level boundary: catches render errors outside the router and never shows
 * a blank screen.
 */
export class RootErrorBoundary extends Component<RootErrorBoundaryProps, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RootErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[shadow-archives] unhandled render error', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="sa-root-error" role="alert">
        <div className="sa-root-error__panel">
          <IconWarning width={28} height={28} />
          <h1 className="sa-root-error__title">Shadow Archives failed to start</h1>
          <p className="sa-root-error__description">
            A rendering error stopped the application shell. Reloading usually recovers; if it
            repeats, the build or host context may be at fault.
          </p>
          <pre className="sa-root-error__detail">{error.message}</pre>
          <Button variant="primary" onClick={() => window.location.reload()}>
            Reload the app
          </Button>
          <p className="sa-route__provenance">
            {siteConfig.name} · {siteConfig.phaseLabel} · v{siteConfig.version}
          </p>
        </div>
      </div>
    );
  }
}
