import type { ReactNode } from 'react';

import { AuthProvider } from './AuthProvider';
import { BridgeProvider } from './BridgeProvider';
import { CapabilityProvider } from './CapabilityProvider';
import { DesignTokensProvider } from './DesignTokensProvider';
import type { QdnEnvironment, QortalAccount } from '../../qortal/types';

interface AppProvidersProps {
  children: ReactNode;
  /** Test seam, forwarded to <BridgeProvider>. */
  environment?: QdnEnvironment;
  /** Test seam, forwarded to <AuthProvider>. Never used at startup. */
  initialAccount?: QortalAccount | null;
}

/**
 * Provider order follows the approved Phase 1A structure (§1.4):
 * bridge -> auth -> capability -> design tokens -> router.
 * Cache/catalog providers arrive with the data phases; they are intentionally
 * absent here rather than stubbed with fake behaviour.
 */
export function AppProviders({ children, environment, initialAccount }: AppProvidersProps) {
  return (
    <BridgeProvider environment={environment}>
      <AuthProvider initialAccount={initialAccount}>
        <CapabilityProvider>
          <DesignTokensProvider>{children}</DesignTokensProvider>
        </CapabilityProvider>
      </AuthProvider>
    </BridgeProvider>
  );
}
