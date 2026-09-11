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
  loadArchive,
  resolvePublisherScope,
  UNSCOPED_MESSAGE,
  type ArchiveSnapshot,
  type LoadArchiveOptions,
  type PublisherScope,
} from '../../services';
import { useQortalEnvironment } from './BridgeProvider';

export const LOADING_SNAPSHOT: ArchiveSnapshot = {
  status: 'loading',
  source: 'none',
  listings: [],
  taxonomy: { categories: [], tags: [] },
  compiledAt: null,
  stale: false,
  partial: false,
  message: null,
  error: null,
  diagnostics: [],
};

type ArchiveLoader = (
  scope: PublisherScope,
  options?: LoadArchiveOptions,
) => Promise<ArchiveSnapshot>;

/**
 * Outside a Qortal host no production publisher identity exists, so the initial
 * state is an honest `unavailable` rather than a loading spinner that resolves to
 * the same thing.
 */
function snapshotForScope(scope: PublisherScope): ArchiveSnapshot {
  if (scope.scoped) return LOADING_SNAPSHOT;
  return { ...LOADING_SNAPSHOT, status: 'unavailable', message: UNSCOPED_MESSAGE };
}

function scopeKeyOf(scope: PublisherScope): string {
  return scope.scoped ? `name:${scope.name}` : `unscoped:${scope.reason}`;
}

interface ContentContextValue {
  readonly snapshot: ArchiveSnapshot;
  readonly scope: PublisherScope;
  /** Re-run discovery, bypassing the cache (user-initiated retry). */
  readonly refresh: () => void;
}

const ContentContext = createContext<ContentContextValue | null>(null);

interface ContentProviderProps {
  children: ReactNode;
  /** Test seam: inject a deterministic loader. */
  readonly loader?: ArchiveLoader;
}

/**
 * Owns the archive snapshot: one catalog-first load per publisher scope, with a
 * stale-while-revalidate refresh when the served cache entry has expired.
 *
 * This provider never authenticates: it issues only the public, idempotent QDN
 * read actions. No `GET_USER_ACCOUNT` is requested to browse the archive.
 */
export function ContentProvider({ children, loader = loadArchive }: ContentProviderProps) {
  const environment = useQortalEnvironment();
  const scope = useMemo(() => resolvePublisherScope(environment), [environment]);
  const scopeKey = scopeKeyOf(scope);

  const [record, setRecord] = useState<{ key: string; snapshot: ArchiveSnapshot }>(() => ({
    key: scopeKey,
    snapshot: snapshotForScope(scope),
  }));
  // Derive the in-flight reset rather than calling setState inside an effect.
  const snapshot = record.key === scopeKey ? record.snapshot : snapshotForScope(scope);

  const loadIdRef = useRef(0);
  const revalidatedRef = useRef(false);

  const runLoad = useCallback(
    async (force: boolean) => {
      const id = loadIdRef.current + 1;
      loadIdRef.current = id;
      let next: ArchiveSnapshot;
      if (!scope.scoped) {
        // No production publisher identity exists, so there is nothing to load
        // and no request may be issued.
        next = snapshotForScope(scope);
      } else {
        try {
          next = await loader(scope, { force });
        } catch {
          // loadArchive normalizes its own errors; this guards an injected loader.
          next = { ...LOADING_SNAPSHOT, status: 'error', message: 'Archive discovery failed.' };
        }
      }
      if (id === loadIdRef.current) setRecord({ key: scopeKey, snapshot: next });
    },
    [loader, scope, scopeKey],
  );

  useEffect(() => {
    revalidatedRef.current = false;
    void runLoad(false);
  }, [runLoad]);

  useEffect(() => {
    if (snapshot.status !== 'stale') return;
    if (revalidatedRef.current) return;
    revalidatedRef.current = true;
    void runLoad(true);
  }, [snapshot.status, runLoad]);

  const refresh = useCallback(() => {
    revalidatedRef.current = true;
    setRecord({ key: scopeKey, snapshot: LOADING_SNAPSHOT });
    void runLoad(true);
  }, [runLoad, scopeKey]);

  const value = useMemo<ContentContextValue>(
    () => ({ snapshot, scope, refresh }),
    [snapshot, scope, refresh],
  );

  return <ContentContext.Provider value={value}>{children}</ContentContext.Provider>;
}

export function useContent(): ContentContextValue {
  const value = useContext(ContentContext);
  if (!value) {
    throw new Error('useContent must be used inside <ContentProvider>');
  }
  return value;
}
