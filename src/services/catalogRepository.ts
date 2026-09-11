import { validateCatalogManifest, validateCatalogPartition } from '../domain/catalog';
import { CACHE_TTL_MS, CATALOG_MANIFEST_IDENTIFIER, LIMITS } from '../domain/constants';
import type { CatalogListing, CatalogManifest, CatalogPartitionDescriptor } from '../domain/types';
import { isCacheFresh, type ContentCache } from './cache';
import { ContentError, toContentError } from './errors';
import { findExactResource, type ExpectedIdentity } from './identity';
import { runBounded } from './queue';
import { parseJsonPayload, type QdnReadPort } from './qdnReader';
import type { ArchiveDiagnostic } from './types';

/** Cache schema version for the manifest record (partition uses catalogVersion). */
const MANIFEST_CACHE_VERSION = 1;

export interface CatalogLoaded {
  readonly kind: 'loaded';
  readonly manifest: CatalogManifest;
  readonly listings: readonly CatalogListing[];
  readonly stale: boolean;
  readonly partial: boolean;
  readonly partitionFailures: number;
  readonly rejectedEntries: number;
  readonly diagnostics: readonly ArchiveDiagnostic[];
}

export type CatalogLoadResult =
  | CatalogLoaded
  | { readonly kind: 'missing' }
  | { readonly kind: 'invalid'; readonly error: ContentError }
  | { readonly kind: 'error'; readonly error: ContentError };

function manifestCacheKey(publisherName: string): string {
  return `catalog:${publisherName.toLowerCase()}:manifest`;
}

function partitionCacheKey(publisherName: string, identifier: string): string {
  return `catalog:${publisherName.toLowerCase()}:partition:${identifier}`;
}

function structuralErrorKind(error: ContentError): boolean {
  return (
    error.kind === 'malformed' || error.kind === 'oversized' || error.kind === 'unsupported-schema'
  );
}

interface JsonReadOk {
  readonly kind: 'ok';
  readonly value: unknown;
  readonly stale: boolean;
}
type JsonReadResult = JsonReadOk | { kind: 'missing' } | { kind: 'error'; error: ContentError };

async function readJsonResource(
  reader: QdnReadPort,
  cache: ContentCache,
  key: string,
  expected: ExpectedIdentity & { identifier: string },
  cap: number,
  version: number,
  ttlMs: number,
  now: number,
  force: boolean,
): Promise<JsonReadResult> {
  const cached = force ? null : await cache.get(key, version);
  if (cached) {
    return { kind: 'ok', value: cached.value, stale: !isCacheFresh(cached, now) };
  }

  const lookup = await findExactResource(reader, expected);
  if (lookup.kind === 'missing') return { kind: 'missing' };
  if (lookup.kind === 'error') return { kind: 'error', error: lookup.error };

  let text: string;
  try {
    text = await reader.fetchText({
      service: expected.service,
      name: expected.name,
      identifier: expected.identifier,
    });
  } catch (error) {
    return { kind: 'error', error: toContentError(error) };
  }
  const parsed = parseJsonPayload(text, cap);
  if (!parsed.ok) return { kind: 'error', error: parsed.error };
  // Only successful payloads are cached; failures are never persisted.
  await cache.put(key, parsed.value, { ttlMs, version });
  return { kind: 'ok', value: parsed.value, stale: false };
}

interface PartitionLoad {
  readonly listings: readonly CatalogListing[];
  readonly rejectedEntries: number;
  readonly stale: boolean;
  readonly failure: ArchiveDiagnostic | null;
  readonly error: ContentError | null;
}

async function loadPartition(
  reader: QdnReadPort,
  cache: ContentCache,
  publisherName: string,
  descriptor: CatalogPartitionDescriptor,
  catalogVersion: number,
  now: number,
  force: boolean,
): Promise<PartitionLoad> {
  const read = await readJsonResource(
    reader,
    cache,
    partitionCacheKey(publisherName, descriptor.identifier),
    { service: 'DOCUMENT', name: publisherName, identifier: descriptor.identifier },
    LIMITS.catalogBytes,
    catalogVersion,
    CACHE_TTL_MS.catalogPartition,
    now,
    force,
  );

  if (read.kind === 'missing') {
    return {
      listings: [],
      rejectedEntries: 0,
      stale: false,
      failure: {
        code: 'catalog-partition-missing',
        level: 'warning',
        message: `Catalog partition ${descriptor.identifier} is missing.`,
      },
      error: new ContentError({
        kind: 'resource-missing',
        message: `Catalog partition ${descriptor.identifier} is missing`,
      }),
    };
  }
  if (read.kind === 'error') {
    return {
      listings: [],
      rejectedEntries: 0,
      stale: false,
      failure: {
        code: 'catalog-partition-error',
        level: 'warning',
        message: `Catalog partition ${descriptor.identifier} could not be read.`,
      },
      error: read.error,
    };
  }

  const validated = validateCatalogPartition(read.value, descriptor.type, descriptor.identifier);
  if (!validated.ok) {
    return {
      listings: [],
      rejectedEntries: 0,
      stale: read.stale,
      failure: {
        code: 'catalog-partition-invalid',
        level: 'warning',
        message: `Catalog partition ${descriptor.identifier} failed validation (${validated.code}).`,
      },
      error: new ContentError({ kind: 'malformed', message: validated.message }),
    };
  }

  return {
    listings: validated.value.listings,
    rejectedEntries: validated.value.rejectedEntries,
    stale: read.stale,
    failure: null,
    error: null,
  };
}

function dedupeListings(listings: readonly CatalogListing[]): CatalogListing[] {
  const byIdentifier = new Map<string, CatalogListing>();
  for (const listing of listings) {
    const existing = byIdentifier.get(listing.identifier);
    if (!existing || listing.updatedAt > existing.updatedAt) {
      byIdentifier.set(listing.identifier, listing);
    }
  }
  return [...byIdentifier.values()].sort(
    (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
  );
}

/**
 * Read the owner-approved partitioned catalog (manifest -> descriptors ->
 * bounded partition fetches -> validated entries).
 *
 * The catalog is derived: it may be stale, partial or unavailable, it never
 * proves ownership, and it never overrides the authoritative entity resource.
 * A partition that fails validation is isolated — the rest of the catalog still
 * loads and the result is reported as partial.
 */
export async function loadCatalog(
  reader: QdnReadPort,
  cache: ContentCache,
  publisherName: string,
  options: { readonly now?: number; readonly force?: boolean } = {},
): Promise<CatalogLoadResult> {
  const now = options.now ?? Date.now();
  const force = options.force ?? false;

  const manifestRead = await readJsonResource(
    reader,
    cache,
    manifestCacheKey(publisherName),
    { service: 'DOCUMENT', name: publisherName, identifier: CATALOG_MANIFEST_IDENTIFIER },
    LIMITS.catalogBytes,
    MANIFEST_CACHE_VERSION,
    CACHE_TTL_MS.catalogManifest,
    now,
    force,
  );

  if (manifestRead.kind === 'missing') return { kind: 'missing' };
  if (manifestRead.kind === 'error') {
    return structuralErrorKind(manifestRead.error)
      ? { kind: 'invalid', error: manifestRead.error }
      : { kind: 'error', error: manifestRead.error };
  }

  const manifestValidation = validateCatalogManifest(manifestRead.value);
  if (!manifestValidation.ok) {
    return {
      kind: 'invalid',
      error: new ContentError({ kind: 'unsupported-schema', message: manifestValidation.message }),
    };
  }
  const manifest = manifestValidation.value;

  const diagnostics: ArchiveDiagnostic[] = [];
  const partitions = await runBounded(
    manifest.partitions,
    LIMITS.partitionConcurrency,
    (descriptor) =>
      loadPartition(reader, cache, publisherName, descriptor, manifest.catalogVersion, now, force),
  );

  const listings: CatalogListing[] = [];
  let partitionFailures = 0;
  let rejectedEntries = 0;
  let stale = manifestRead.stale;

  for (const result of partitions) {
    if (!result.ok) {
      partitionFailures += 1;
      continue;
    }
    const partition = result.value;
    if (partition.failure) {
      partitionFailures += 1;
      diagnostics.push(partition.failure);
      continue;
    }
    stale = stale || partition.stale;
    rejectedEntries += partition.rejectedEntries;
    listings.push(...partition.listings);
  }

  if (manifest.partitions.length > 0 && partitionFailures === manifest.partitions.length) {
    return {
      kind: 'invalid',
      error: new ContentError({
        kind: 'partial-catalog',
        message: 'Every declared catalog partition failed to load',
      }),
    };
  }

  if (rejectedEntries > 0) {
    diagnostics.push({
      code: 'catalog-entries-rejected',
      level: 'warning',
      message: `${rejectedEntries} catalog entr(y|ies) failed validation and were skipped.`,
    });
  }

  return {
    kind: 'loaded',
    manifest,
    listings: dedupeListings(listings),
    stale,
    partial: partitionFailures > 0 || rejectedEntries > 0,
    partitionFailures,
    rejectedEntries,
    diagnostics,
  };
}
