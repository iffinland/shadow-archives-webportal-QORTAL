import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import {
  getAccountNames,
  getSessionAccount,
  requestAccount,
  resetAuthSession,
  resolvePublisherOwnership,
  retryAccount,
} from '../../qortal/auth';
import { QortalBridgeError } from '../../qortal/bridge';
import type { AuthPermissionState, QortalAccount, QortalNameSummary } from '../../qortal/types';
import { useQortalEnvironment } from './BridgeProvider';

interface AuthenticateOptions {
  /**
   * Explicit retry after a failure. Only set from a deliberate user action;
   * never from an effect. Without it a cached rejection is returned unchanged.
   */
  readonly retry?: boolean;
}

interface AuthContextValue {
  readonly permission: AuthPermissionState;
  readonly account: QortalAccount | null;
  /** All names owned by the connected account; never collapsed into one. */
  readonly ownedNames: readonly QortalNameSummary[];
  readonly ownsPublisherName: boolean | null;
  readonly ownsAnyName: boolean | null;
  readonly ownershipResolved: boolean;
  /**
   * Explicit, user-triggered authentication. It is intentionally NOT called on
   * mount: the visitor shell must remain permission-free, and capability stays
   * `unknown` until a real answer exists. Concurrent calls share one request.
   */
  readonly authenticate: (options?: AuthenticateOptions) => Promise<void>;
  /** Abandon a pending capability run and return the app to read-only. */
  readonly cancel: () => void;
  /** Drop all capability state (sign-out). */
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
  const [ownedNames, setOwnedNames] = useState<readonly QortalNameSummary[]>([]);
  const [ownsPublisherName, setOwnsPublisherName] = useState<boolean | null>(null);
  const [ownsAnyName, setOwnsAnyName] = useState<boolean | null>(null);
  const [ownershipResolved, setOwnershipResolved] = useState(false);

  // A generation token lets a cancel ignore any late result from the host.
  const generationRef = useRef(0);
  const inFlightRef = useRef<Promise<void> | null>(null);

  const resolveIdentity = useCallback(
    async (resolved: QortalAccount, generation: number) => {
      let names: QortalNameSummary[] = [];
      let namesResolved: boolean;
      try {
        names = await getAccountNames(resolved.address);
        namesResolved = true;
      } catch {
        // Unknown, not "no name": leave ownsAnyName null so the capability
        // never claims a false negative.
        namesResolved = false;
      }
      if (generation !== generationRef.current) return;

      const ownership = await resolvePublisherOwnership(environment.publisherName, resolved);
      if (generation !== generationRef.current) return;

      setOwnedNames(names);
      setOwnsPublisherName(ownership);
      setOwnsAnyName(namesResolved ? names.length > 0 : null);
      setOwnershipResolved(true);
    },
    [environment.publisherName],
  );

  const authenticate = useCallback(
    (options?: AuthenticateOptions): Promise<void> => {
      if (inFlightRef.current) return inFlightRef.current;

      const generation = generationRef.current + 1;
      generationRef.current = generation;
      setPermission('pending');
      setOwnershipResolved(false);
      setOwnsPublisherName(null);
      setOwnsAnyName(null);

      const run = (async () => {
        try {
          const resolved = options?.retry ? await retryAccount() : await requestAccount();
          if (generation !== generationRef.current) return;
          setAccount(resolved);
          setPermission('granted');
          await resolveIdentity(resolved, generation);
        } catch (error) {
          if (generation !== generationRef.current) return;
          const kind = error instanceof QortalBridgeError ? error.kind : 'error';
          setPermission(kind === 'rejected' ? 'rejected' : 'unavailable');
          setAccount(getSessionAccount());
          setOwnedNames([]);
          setOwnsPublisherName(null);
          setOwnsAnyName(null);
          setOwnershipResolved(true);
        } finally {
          if (generation === generationRef.current) inFlightRef.current = null;
        }
      })();

      inFlightRef.current = run;
      return run;
    },
    [resolveIdentity],
  );

  const cancel = useCallback(() => {
    generationRef.current += 1;
    inFlightRef.current = null;
    setPermission('idle');
    setAccount(getSessionAccount());
    setOwnedNames([]);
    setOwnsPublisherName(null);
    setOwnsAnyName(null);
    setOwnershipResolved(false);
  }, []);

  const reset = useCallback(() => {
    generationRef.current += 1;
    inFlightRef.current = null;
    resetAuthSession();
    setPermission('idle');
    setAccount(null);
    setOwnedNames([]);
    setOwnsPublisherName(null);
    setOwnsAnyName(null);
    setOwnershipResolved(false);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      permission,
      account,
      ownedNames,
      ownsPublisherName,
      ownsAnyName,
      ownershipResolved,
      authenticate,
      cancel,
      reset,
    }),
    [
      permission,
      account,
      ownedNames,
      ownsPublisherName,
      ownsAnyName,
      ownershipResolved,
      authenticate,
      cancel,
      reset,
    ],
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
