import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
import {
  clearOwnerModeMarker,
  isOwnerModeMarked,
  markOwnerMode,
} from '../../qortal/ownerModeSession';
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
   * Starts the single owner-capability verification flow. Calls share one
   * request, so the automatic hosted-runtime check and an owner action cannot
   * create duplicate account prompts.
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
    async (resolved: QortalAccount, generation: number): Promise<boolean | null> => {
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
      if (generation !== generationRef.current) return null;

      const ownership = await resolvePublisherOwnership(environment.publisherName, resolved);
      if (generation !== generationRef.current) return null;

      setOwnedNames(names);
      setOwnsPublisherName(ownership);
      setOwnsAnyName(namesResolved ? names.length > 0 : null);
      setOwnershipResolved(true);
      return ownership;
    },
    [environment.publisherName],
  );

  /**
   * Re-verify owner capability from the live host: current account first, then
   * the *current* owner of the injected publishing name. This is the only path
   * that can produce the `owner` capability, and it is used both by the explicit
   * user action and by the tab-scoped restore below.
   */
  const verifyOwnerMode = useCallback(
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
          const ownership = await resolveIdentity(resolved, generation);
          if (generation !== generationRef.current) return;
          // Only a positive current ownership proof keeps the tab marker.
          if (ownership !== true) clearOwnerModeMarker();
        } catch (error) {
          if (generation !== generationRef.current) return;
          const kind = error instanceof QortalBridgeError ? error.kind : 'error';
          setPermission(kind === 'rejected' ? 'rejected' : 'unavailable');
          setAccount(getSessionAccount());
          setOwnedNames([]);
          setOwnsPublisherName(null);
          setOwnsAnyName(null);
          setOwnershipResolved(true);
          clearOwnerModeMarker();
        } finally {
          if (generation === generationRef.current) inFlightRef.current = null;
        }
      })();

      inFlightRef.current = run;
      return run;
    },
    [resolveIdentity],
  );

  /**
   * Explicit user action. The tab marker records only the *intent* to be in
   * owner mode; it is never authority, so capability still requires the positive
   * ownership proof that `verifyOwnerMode` performs against the live host.
   */
  const authenticate = useCallback(
    (options?: AuthenticateOptions): Promise<void> => {
      markOwnerMode();
      return verifyOwnerMode(options);
    },
    [verifyOwnerMode],
  );

  /**
   * One automatic owner check per direct Qortal-host mount. This removes the
   * former `/studio` prerequisite: a positively verified owner immediately sees
   * creation and edit controls on the content routes. The call is deliberately
   * excluded from the dev proxy and read-only render contexts, which cannot
   * establish write authority. Hub may ask for account access on first use.
   */
  const restoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;
    if (environment.runtimeState !== 'qortal-host') return;
    if (isOwnerModeMarked()) {
      void verifyOwnerMode();
      return;
    }
    void authenticate();
  }, [authenticate, environment.runtimeState, verifyOwnerMode]);

  const cancel = useCallback(() => {
    generationRef.current += 1;
    inFlightRef.current = null;
    clearOwnerModeMarker();
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
    clearOwnerModeMarker();
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
