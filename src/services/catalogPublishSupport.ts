/**
 * Shared derived-catalog write support.
 *
 * Both owner publishing flows (Gallery and Video) plan the same derived index
 * from the same read pipeline, so the "read the index, decide whether it may be
 * rewritten, plan the partition+manifest" logic lives here once. The modules
 * that own ordering, authority and error handling stay per-feature.
 *
 * The catalog remains derived and non-authoritative: it is never allowed to
 * block or roll back the authoritative entity write, and an unusable index is
 * skipped (and reported) rather than rebuilt from a partial view.
 *
 * Not re-exported from `services/index.ts`, so it stays out of the visitor
 * startup graph.
 */

import type { EntityKind } from '../domain/constants';
import { buildEntityIdentifier } from '../domain/identifiers';
import type { CatalogListing, CatalogManifest } from '../domain/types';
import type { ContentCache } from './cache';
import { loadCatalog, type CatalogLoadResult } from './catalogRepository';
import {
  assertCatalogPlanValid,
  planCatalogWrite,
  type CatalogChecksumFn,
  type CatalogWritePlan,
} from './catalogWriter';
import { findExactResource } from './identity';
import type { QdnReadPort } from './qdnReader';

/** The subset of publish dependencies this module needs (features may add more). */
export interface CatalogPublishDeps {
  readonly reader: QdnReadPort;
  readonly cache: ContentCache;
  readonly now: () => number;
  readonly delay?: (ms: number) => Promise<void>;
  readonly checksumFn?: CatalogChecksumFn;
}

/** The derived index as read before a write. */
export interface ExistingCatalog {
  readonly manifest: CatalogManifest | null;
  readonly listings: readonly CatalogListing[];
}

export interface CatalogContextBase {
  readonly existing: ExistingCatalog;
  /** Non-null when the derived index must NOT be rewritten this time. */
  readonly skipReason: string | null;
}

export interface CatalogWriteContext {
  /** `null` when the index cannot be safely updated (see `skipReason`). */
  readonly plan: CatalogWritePlan | null;
  readonly skipReason: string | null;
}

/** Bounded retries when the index data is not yet available on the read node. */
const CATALOG_READ_MAX_ATTEMPTS = 3;
const CATALOG_READ_RETRY_MS = 600;

export function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Read the derived index, retrying a transient read failure a bounded number of
 * times. Data availability on a Qortal node lags the search index: a resource
 * can be discoverable while its bytes are still `MISSING_DATA`/`DOWNLOADING`.
 * Without a retry, that transient state was treated as a permanently unreadable
 * index and the newly published entity was never added to the catalog.
 */
export async function loadCatalogForPublish(
  deps: CatalogPublishDeps,
  publisherName: string,
): Promise<CatalogLoadResult> {
  const attempt = (): Promise<CatalogLoadResult> =>
    loadCatalog(deps.reader, deps.cache, publisherName, { now: deps.now(), force: true });
  let result = await attempt();
  for (let round = 1; round < CATALOG_READ_MAX_ATTEMPTS && result.kind === 'error'; round += 1) {
    await (deps.delay ?? defaultDelay)(CATALOG_READ_RETRY_MS);
    result = await attempt();
  }
  return result;
}

/**
 * Decide whether the derived index may be rewritten, and with which existing
 * entries.
 *
 * A genuinely missing catalog is bootstrapped (empty base, no skip). An index
 * that is invalid, unreadable or only partially readable is left untouched,
 * because republishing it from a partial view could drop entries; the
 * authoritative content is still published and the read path reconciles it with
 * bounded discovery.
 *
 * `subject` names the feature in the owner-facing skip message.
 */
export async function readCatalogContext(
  deps: CatalogPublishDeps,
  publisherName: string,
  subject: string,
  repair?: (existing: ExistingCatalog) => Promise<ExistingCatalog>,
): Promise<CatalogContextBase> {
  const catalog = await loadCatalogForPublish(deps, publisherName);

  if (catalog.kind === 'error') {
    return {
      existing: { manifest: null, listings: [] },
      skipReason: `The ${subject} index could not be read, so it was left untouched. The content itself is published and discoverable by the fallback scan.`,
    };
  }
  if (catalog.kind === 'invalid') {
    return {
      existing: { manifest: null, listings: [] },
      skipReason: `The ${subject} index is invalid or uses an unsupported version, so it was left untouched to avoid overwriting it.`,
    };
  }
  if (catalog.kind === 'loaded' && (catalog.partial || catalog.rejectedEntries > 0)) {
    return {
      existing: { manifest: null, listings: [] },
      skipReason: `The ${subject} index could not be read completely, so it was left untouched to avoid dropping existing entries.`,
    };
  }
  const base: ExistingCatalog =
    catalog.kind === 'loaded'
      ? { manifest: catalog.manifest, listings: catalog.listings }
      : { manifest: null, listings: [] };
  return { existing: repair ? await repair(base) : base, skipReason: null };
}

/**
 * Build the partition + manifest payloads for one catalog upsert.
 *
 * A planning or validation failure never blocks the content write: the catalog
 * is derived and the entity is authoritative, so the index is skipped and the
 * reason is reported truthfully instead.
 */
export async function planCatalogEntry(
  deps: CatalogPublishDeps,
  publisherName: string,
  subject: string,
  type: EntityKind,
  entry: Parameters<typeof planCatalogWrite>[0]['entry'],
  base: CatalogContextBase,
): Promise<CatalogWriteContext> {
  if (base.skipReason) return { plan: null, skipReason: base.skipReason };
  try {
    const plan = await planCatalogWrite({
      type,
      entry,
      publisherName,
      compiledAt: deps.now(),
      existing: base.existing,
      checksumFn: deps.checksumFn,
    });
    assertCatalogPlanValid(plan);
    return { plan, skipReason: null };
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    return {
      plan: null,
      skipReason: `The ${subject} index could not be prepared for this publication (${detail}), so it was left untouched.`,
    };
  }
}

/** Bounded collision check against the derived index and one exact lookup. */
export async function catalogIdIsTaken(
  deps: CatalogPublishDeps,
  publisherName: string,
  kind: EntityKind,
  id: string,
  knownIds: ReadonlySet<string>,
): Promise<boolean> {
  if (knownIds.has(id)) return true;
  const identifier = buildEntityIdentifier(kind, id);
  const lookup = await findExactResource(deps.reader, {
    service: 'DOCUMENT',
    name: publisherName,
    identifier,
  });
  return lookup.kind === 'found';
}

/** Deterministic SHA-256 of a JSON-serialized payload, or null when unavailable. */
export async function contentHashOf(value: unknown): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const digest = await subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    return `sha256:${hex}`;
  } catch {
    return null;
  }
}

/** `contentHashOf`, downgraded to `null` instead of throwing. */
export async function safeContentHashOf(
  value: unknown,
  checksumFn?: CatalogChecksumFn,
): Promise<string | null> {
  try {
    return checksumFn ? await checksumFn(value) : await contentHashOf(value);
  } catch {
    return null;
  }
}
