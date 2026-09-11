import { useEffect, type ReactNode } from 'react';

import { useQortalEnvironment } from './BridgeProvider';

/**
 * Syncs host-provided context/language onto the document root so CSS and
 * assistive tech see the real runtime context. The brand is dark-only for
 * Phase 1B, so no light theme is applied.
 */
export function DesignTokensProvider({ children }: { children: ReactNode }) {
  const environment = useQortalEnvironment();

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.qdnContext = environment.context ?? 'browser';
    if (environment.lang) root.lang = environment.lang;
  }, [environment.context, environment.lang]);

  return children;
}
