import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { deriveCapability } from '../../qortal/capability';
import type { CapabilityState } from '../../qortal/types';
import { useAuth } from './AuthProvider';
import { useQortalEnvironment } from './BridgeProvider';

interface CapabilityContextValue {
  readonly capability: CapabilityState;
  readonly isOwner: boolean;
}

const CapabilityContext = createContext<CapabilityContextValue | null>(null);

export function CapabilityProvider({ children }: { children: ReactNode }) {
  const environment = useQortalEnvironment();
  const { permission, account, ownsPublisherName, ownsAnyName, ownershipResolved } = useAuth();

  const value = useMemo<CapabilityContextValue>(() => {
    const capability = deriveCapability({
      environment,
      permission,
      account,
      ownsPublisherName,
      ownsAnyName,
      ownershipResolved,
    });
    return { capability, isOwner: capability === 'owner' };
  }, [environment, permission, account, ownsPublisherName, ownsAnyName, ownershipResolved]);

  return <CapabilityContext.Provider value={value}>{children}</CapabilityContext.Provider>;
}

export function useCapability(): CapabilityContextValue {
  const value = useContext(CapabilityContext);
  if (!value) {
    throw new Error('useCapability must be used inside <CapabilityProvider>');
  }
  return value;
}
