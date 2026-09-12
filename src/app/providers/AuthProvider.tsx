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
   * Explicit, user-triggered authentication. It is intentionally NOT called for
   * an ordinary mount: the visitor shell must remain permission-free, and
   * capability stays `unknown` until a real answer exists. Concurrent calls
   * share one request. A mount restores only when this tab previously marked an
   * explicit owner-mode session (see `restoreAttemptedRef` below).
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
   * Tab-scoped restoration after a real document reload.
   *
   * With no marker this effect does nothing at all: no account request, no
   * permission prompt, so the visitor shell stays permission-free. With a marker
   * in a `qortal-host` runtime it re-runs the full verification (current account
   * + current name owner); owner controls stay hidden until that proof exists.
   * The ref guard makes this once per mount, and the marker is removed by
   * `verifyOwnerMode` on every non-owner outcome, so a failed restore cannot
   * turn into a retry loop.
   */
  const restoreAttemptedRef = useRef(false);
  useEffect(() => {
    if (restoreAttemptedRef.current) return;
    restoreAttemptedRef.current = true;
    if (!isOwnerModeMarked()) return;
    if (environment.runtimeState !== 'qortal-host') return;
    void verifyOwnerMode();
  }, [environment.runtimeState, verifyOwnerMode]);

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
