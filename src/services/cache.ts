/**
 * Bounded read cache for expensive/repeat QDN reads.
 *
 * - App-namespaced IndexedDB database (`shadow-archives-qdn`). This app never
 *   reuses `qapp-core`'s shared `MyAppDB`.
 * - Explicit schema version and typed records.
 * - Success TTL only: failures are never written, so a failed read can never
 *   permanently hide a later success.
 * - A record whose `version` differs from the caller's is treated as a miss, so
 *   a schema change invalidates by version as well as by time.
 * - Falls back to an in-memory store when IndexedDB is unavailable (jsdom,
 *   private mode), so the app degrades rather than throwing.
 */

export const CACHE_DB_NAME = 'shadow-archives-qdn';
export const CACHE_DB_VERSION = 1;
export const CACHE_STORE_NAME = 'records';

export interface CacheRecord<T> {
  readonly key: string;
  readonly value: T;
  readonly storedAt: number;
  readonly expiresAt: number;
  readonly version: number;
}

export interface CachePutOptions {
  readonly ttlMs: number;
  /** Caller-defined schema/version; a mismatch invalidates the stored record. */
  readonly version?: number;
}

export interface ContentCache {
  /**
   * Read a record regardless of expiry (version-checked). The caller decides
   * freshness so it can implement stale-while-revalidate rather than treating an
   * expired-but-usable record as a miss.
   */
  get<T>(key: string, version?: number): Promise<CacheRecord<T> | null>;
  put<T>(key: string, value: T, options: CachePutOptions): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

interface RawStore {
  read(key: string): Promise<CacheRecord<unknown> | null>;
  write(record: CacheRecord<unknown>): Promise<void>;
  remove(key: string): Promise<void>;
  clearAll(): Promise<void>;
}

function createMemoryStore(): RawStore {
  const records = new Map<string, CacheRecord<unknown>>();
  return {
    async read(key) {
      return records.get(key) ?? null;
    },
    async write(record) {
      records.set(record.key, record);
    },
    async remove(key) {
      records.delete(key);
    },
    async clearAll() {
      records.clear();
    },
  };
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function createIndexedDbStore(db: IDBDatabase): RawStore {
  async function withStore<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> {
    const transaction = db.transaction(CACHE_STORE_NAME, mode);
    const store = transaction.objectStore(CACHE_STORE_NAME);
    return run(store);
  }

  return {
    async read(key) {
      return withStore('readonly', async (store) => {
        const result = await requestToPromise(store.get(key));
        return (result as CacheRecord<unknown> | undefined) ?? null;
      });
    },
    async write(record) {
      await withStore('readwrite', async (store) => {
        await requestToPromise(store.put(record));
      });
    },
    async remove(key) {
      await withStore('readwrite', async (store) => {
        await requestToPromise(store.delete(key));
      });
    },
    async clearAll() {
      await withStore('readwrite', async (store) => {
        await requestToPromise(store.clear());
      });
    },
  };
}

async function openIndexedDbStore(): Promise<RawStore | null> {
  if (typeof indexedDB === 'undefined') return null;
  try {
    const request = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
        db.createObjectStore(CACHE_STORE_NAME, { keyPath: 'key' });
      }
    };
    const db = await requestToPromise(request);
    return createIndexedDbStore(db);
  } catch {
    return null;
  }
}

export interface CreateCacheOptions {
  /** Injectable clock for tests. */
  readonly now?: () => number;
}

export function createContentCache(options: CreateCacheOptions = {}): ContentCache {
  const now = options.now ?? (() => Date.now());
  let storePromise: Promise<RawStore> | null = null;

  function store(): Promise<RawStore> {
    storePromise ??= openIndexedDbStore().then((idb) => idb ?? createMemoryStore());
    return storePromise;
  }

  return {
    async get<T>(key: string, version = 1): Promise<CacheRecord<T> | null> {
      const record = await (await store()).read(key);
      if (!record) return null;
      if (record.version !== version) return null;
      return record as CacheRecord<T>;
    },
    async put<T>(key: string, value: T, putOptions: CachePutOptions): Promise<void> {
      const storedAt = now();
      await (
        await store()
      ).write({
        key,
        value,
        storedAt,
        expiresAt: storedAt + putOptions.ttlMs,
        version: putOptions.version ?? 1,
      });
    },
    async delete(key: string): Promise<void> {
      await (await store()).remove(key);
    },
    async clear(): Promise<void> {
      await (await store()).clearAll();
    },
  };
}

/** True when a cache record is still inside its success TTL. */
export function isCacheFresh(record: CacheRecord<unknown>, now = Date.now()): boolean {
  return record.expiresAt > now;
}

let sharedCache: ContentCache | null = null;

/** Shared cache instance for the running app. */
export function getContentCache(): ContentCache {
  sharedCache ??= createContentCache();
  return sharedCache;
}

/** Test helper: forget the shared instance. */
export function resetContentCache(): void {
  sharedCache = null;
}
