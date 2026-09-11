import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { readQdnEnvironment } from '../../qortal/environment';
import type { QdnEnvironment } from '../../qortal/types';

const BridgeContext = createContext<QdnEnvironment | null>(null);

interface BridgeProviderProps {
  children: ReactNode;
  /** Test seam: inject an environment instead of reading the global window. */
  environment?: QdnEnvironment;
}

/**
 * Reads the injected `_qdn*` globals exactly once per mount and exposes them as
 * a typed, frozen context. No network, no permission prompt, no side effects.
 */
export function BridgeProvider({ children, environment }: BridgeProviderProps) {
  const value = useMemo<QdnEnvironment>(() => environment ?? readQdnEnvironment(), [environment]);
  return <BridgeContext.Provider value={value}>{children}</BridgeContext.Provider>;
}

export function useQortalEnvironment(): QdnEnvironment {
  const value = useContext(BridgeContext);
  if (!value) {
    throw new Error('useQortalEnvironment must be used inside <BridgeProvider>');
  }
  return value;
}
