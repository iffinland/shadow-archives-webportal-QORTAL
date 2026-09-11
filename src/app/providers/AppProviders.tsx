import type { ReactNode } from 'react';

import { AuthProvider } from './AuthProvider';
import { BridgeProvider } from './BridgeProvider';
import { CapabilityProvider } from './CapabilityProvider';
import { ContentProvider } from './ContentProvider';
import { DesignTokensProvider } from './DesignTokensProvider';
import type { QdnEnvironment, QortalAccount } from '../../qortal/types';
import type { ArchiveSnapshot, LoadArchiveOptions, PublisherScope } from '../../services';

interface AppProvidersProps {
  children: ReactNode;
  /** Test seam, forwarded to <BridgeProvider>. */
  environment?: QdnEnvironment;
  /** Test seam, forwarded to <AuthProvider>. Never used at startup. */
  initialAccount?: QortalAccount | null;
  /** Test seam, forwarded to <ContentProvider>. */
  archiveLoader?: (scope: PublisherScope, options?: LoadArchiveOptions) => Promise<ArchiveSnapshot>;
}

/**
 * Provider order follows the approved Phase 1A structure (§1.4):
 * bridge -> auth -> capability -> content (cache/catalog) -> design tokens -> router.
 *
 * The content provider performs only public, idempotent QDN reads. Authentication
 * remains dormant unless an explicit owner flow requests it.
 */
export function AppProviders({
  children,
  environment,
  initialAccount,
  archiveLoader,
}: AppProvidersProps) {
  return (
    <BridgeProvider environment={environment}>
      <AuthProvider initialAccount={initialAccount}>
        <CapabilityProvider>
          <ContentProvider loader={archiveLoader}>
            <DesignTokensProvider>{children}</DesignTokensProvider>
          </ContentProvider>
        </CapabilityProvider>
      </AuthProvider>
    </BridgeProvider>
  );
}
