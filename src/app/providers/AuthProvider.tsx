import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import {
  getAccountNames,
  getSessionAccount,
  requestAccount,
  resetAuthSession,
  resolvePublisherOwnership,
} from '../../qortal/auth';
import { QortalBridgeError } from '../../qortal/bridge';
import type { AuthPermissionState, QortalAccount } from '../../qortal/types';
import { useQortalEnvironment } from './BridgeProvider';

interface AuthContextValue {
  readonly permission: AuthPermissionState;
  readonly account: QortalAccount | null;
  readonly ownedNames: readonly string[];
  readonly ownsPublisherName: boolean | null;
  /**
   * Explicit, user-triggered authentication. It is intentionally NOT called on
   * mount: the visitor shell must remain permission-free, and capability stays
   * `unknown` until a real answer exists.
   */
  readonly authenticate: () => Promise<void>;
  readonly reset: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
  /** Test seam: preseed the session account without a bridge call. */
  initialAccount?: QortalAccount | null;
}

export function AuthProvider({ children, initialAccount = null }: AuthProviderProps) {
  const environment = useQortalEnvironment();
  const [permission, setPermission] = useState<AuthPermissionState>(
    initialAccount ? 'granted' : 'idle',
  );
  const [account, setAccount] = useState<QortalAccount | null>(initialAccount);
  const [ownedNames, setOwnedNames] = useState<readonly string[]>([]);
  const [ownsPublisherName, setOwnsPublisherName] = useState<boolean | null>(null);

  const authenticate = useCallback(async () => {
    setPermission('pending');
    try {
      const resolved = await requestAccount();
      setAccount(resolved);
      setPermission('granted');

      const names = await getAccountNames(resolved.address).catch(() => [] as string[]);
      setOwnedNames(names);
      const ownership = await resolvePublisherOwnership(environment.publisherName, resolved);
      setOwnsPublisherName(ownership);
    } catch (error) {
      const kind = error instanceof QortalBridgeError ? error.kind : 'error';
      setPermission(kind === 'rejected' ? 'rejected' : 'unavailable');
      setAccount(getSessionAccount());
      setOwnsPublisherName(null);
    }
  }, [environment.publisherName]);

  const reset = useCallback(() => {
    resetAuthSession();
    setPermission('idle');
    setAccount(null);
    setOwnedNames([]);
    setOwnsPublisherName(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ permission, account, ownedNames, ownsPublisherName, authenticate, reset }),
    [permission, account, ownedNames, ownsPublisherName, authenticate, reset],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return value;
}
