import { CACHE_TTL_MS, LIMITS, type EntityKind } from '../domain/constants';
import { validateEntityPayload } from '../domain/entities';
import { buildEntityIdentifier, resolveEntityReference } from '../domain/identifiers';
import { dedupeTaxonomy, taxonomyIncludesSlug, toTaxonomyReference } from '../domain/taxonomy';
import type { CatalogListing, ShadowArchiveEntity, TaxonomyReference } from '../domain/types';
import { getContentCache, isCacheFresh, type CacheRecord, type ContentCache } from './cache';
import { loadCatalog, type CatalogLoadResult } from './catalogRepository';
import { ContentError, toContentError } from './errors';
import {
  discoverArchive,
  type FallbackDiscoveryOptions,
  type FallbackDiscoveryResult,
} from './fallbackDiscovery';
import { entityIdentifierMatches, findExactResource } from './identity';
import { bridgeQdnReadPort, parseJsonPayload, type QdnReadPort } from './qdnReader';
import { unscopedMessage, type PublisherScope } from './publisher';
import type { ArchiveDiagnostic, ArchiveSnapshot, EntityDetailResult } from './types';

const ENTITY_CACHE_VERSION = 1;

/** Cache key for one entity payload. Exported so the publish path can invalidate it. */
export function entityCacheKey(publisherName: string, identifier: string): string {
  return `entity:${publisherName.toLowerCase()}:${identifier}`;
}

/** Drop cached entity payloads for the given identifiers (used after a publish). */
export async function invalidateEntityCache(
  cache: ContentCache,
  publisherName: string,
  identifiers: readonly string[],
): Promise<void> {
  for (const identifier of identifiers) {
    await cache.delete(entityCacheKey(publisherName, identifier));
  }
}

export function aggregateTaxonomy(listings: readonly CatalogListing[]): {
  categories: TaxonomyReference[];
  tags: TaxonomyReference[];
} {
  const categories: TaxonomyReference[] = [];
  const tags: TaxonomyReference[] = [];
  for (const listing of listings) {
    for (const label of listing.categories) {
      const reference = toTaxonomyReference(label);
      if (reference) categories.push(reference);
    }
    for (const label of listing.tags) {
      const reference = toTaxonomyReference(label);
      if (reference) tags.push(reference);
    }
  }
  return {
    categories: dedupeTaxonomy(categories).sort((a, b) => a.label.localeCompare(b.label)),
    tags: dedupeTaxonomy(tags).sort((a, b) => a.label.localeCompare(b.label)),
  };
}

function emptySnapshot(
  status: ArchiveSnapshot['status'],
  message: string,
  error: ContentError | null = null,
  diagnostics: readonly ArchiveDiagnostic[] = [],
): ArchiveSnapshot {
  return {
    status,
    source: 'none',
    listings: [],
    taxonomy: { categories: [], tags: [] },
    compiledAt: null,
    stale: false,
    partial: false,
    message,
    error,
    diagnostics,
  };
}

export interface LoadArchiveOptions {
  readonly reader?: QdnReadPort;
  readonly cache?: ContentCache;
  readonly now?: number;
  /** Skip the cache read and re-fetch (stale-while-revalidate refresh). */
  readonly force?: boolean;
}

/**
 * Merge authoritative live-discovery listings into catalog listings.
 *
 * The catalog is a derived index: it is permitted to be stale or incomplete. A
 * catalog entry wins on an identifier conflict because it carries the richer
 * compiled summary; a listing that discovery found but the index does not carry
 * is added, so a missing/incomplete index can never hide a published entity.
 */
export function mergeListings(
  catalogListings: readonly CatalogListing[],
  discoveredListings: readonly CatalogListing[],
): { readonly listings: CatalogListing[]; readonly added: number } {
  const byIdentifier = new Map<string, CatalogListing>();
  for (const listing of catalogListings) byIdentifier.set(listing.identifier, listing);
  let added = 0;
  for (const listing of discoveredListings) {
    if (byIdentifier.has(listing.identifier)) continue;
    byIdentifier.set(listing.identifier, listing);
    added += 1;
  }
  const listings = [...byIdentifier.values()].sort(
    (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
  );
  return { listings, added };
}

/**
 * Bounded, metadata-only discovery used to keep the derived index honest.
 *
 * It costs a few prefix searches and never downloads an entity body, so it is
 * safe to run alongside the catalog on every load. It is best-effort: a failure
 * is reported, never fatal on its own.
 */
async function discoverAuthoritative(
  reader: QdnReadPort,
  publisherName: string,
  options: FallbackDiscoveryOptions = {},
): Promise<FallbackDiscoveryResult | null> {
  try {
    return await discoverArchive(reader, publisherName, options);
  } catch {
    return null;
  }
}

/** `loadCatalog` normalized to a result; a thrown transport error is a result. */
async function loadCatalogSafely(
  reader: QdnReadPort,
  cache: ContentCache,
  publisherName: string,
  now: number,
  force: boolean | undefined,
): Promise<CatalogLoadResult> {
  try {
    return await loadCatalog(reader, cache, publisherName, { now, force });
  } catch (error) {
    return { kind: 'error', error: toContentError(error) };
  }
}

/**
 * Load the archive snapshot.
 *
 * The catalog is the primary index (authoritative entity resources remain the
 * source of truth), but it never proves completeness. A bounded read-only
 * discovery runs alongside it and is merged in, and it is also the recovery path
 * when the catalog is absent, corrupt, unsupported or unreadable — matching the
 * contract's rule that catalog absence/unavailability must never be presented as
 * "no content" and that recovery is a direct prefix search.
 */
export async function loadArchive(
  scope: PublisherScope,
  options: LoadArchiveOptions = {},
): Promise<ArchiveSnapshot> {
  if (!scope.scoped) {
    return emptySnapshot('unavailable', unscopedMessage(scope.reason));
  }

  // The transport is chosen by the caller from the runtime state
  // (`resolveQdnReadPort`): a published render context without the host bridge
  // reads over verified same-origin REST instead of failing as unavailable.
  const reader = options.reader ?? bridgeQdnReadPort;
  const cache = options.cache ?? getContentCache();
  const now = options.now ?? Date.now();

  const catalog = await loadCatalogSafely(reader, cache, scope.name, now, options.force);

  // A readable catalog is the primary index, so reconciliation only needs to
  // cover recent index lag: one newest-first page per kind. An unusable catalog
  // uses the full bounded fallback discovery instead.
  const discovery = await discoverAuthoritative(
    reader,
    scope.name,
    catalog.kind === 'loaded' ? { maxPages: 1 } : {},
  );
  const catalogListings = catalog.kind === 'loaded' ? catalog.listings : [];
  const merged = mergeListings(catalogListings, discovery?.listings ?? []);

  if (catalog.kind === 'loaded') {
    const diagnostics = [...catalog.diagnostics, ...(discovery?.diagnostics ?? [])];
    const reconciled = merged.added > 0;
    const partial = catalog.partial || catalog.rejectedEntries > 0 || reconciled;
    if (reconciled) {
      diagnostics.push({
        code: 'catalog-reconciled',
        level: 'info',
        message: `${merged.added} published item(s) were missing from the archive index and were restored from live discovery.`,
      });
    }
    const base = {
      source: 'catalog' as const,
      listings: merged.listings,
      taxonomy: aggregateTaxonomy(merged.listings),
      compiledAt: catalog.manifest.compiledAt,
      stale: catalog.stale,
      partial,
      diagnostics,
    };

    if (base.listings.length === 0) {
      return {
        ...base,
        status: 'empty',
        message: 'The archive index is available and contains no published content yet.',
        error: null,
      };
    }
    if (catalog.stale) {
      return {
        ...base,
        status: 'stale',
        message: 'Showing the last cached archive index; it may be out of date.',
        error: null,
      };
    }
    if (reconciled) {
      return {
        ...base,
        status: 'partial',
        message:
          'The archive index was out of date; it has been reconciled with live discovery and listings may be incomplete.',
        error: null,
      };
    }
    if (catalog.partial) {
      return {
        ...base,
        status: 'partial',
        message: 'Some catalog partitions could not be read; listings may be incomplete.',
        error: null,
      };
    }
    return { ...base, status: 'ready', message: null, error: null };
  }

  // Catalog missing, invalid or unreadable: bounded live discovery is the
  // recovery path. The catalog failure is reported as a diagnostic, never as an
  // empty/error-only snapshot that hides published content.
  const fallbackDiagnostics: ArchiveDiagnostic[] = [];
  if (catalog.kind === 'invalid') {
    fallbackDiagnostics.push({
      code: 'catalog-invalid',
      level: 'warning',
      message: 'The archive catalog index is unavailable or invalid.',
    });
  } else if (catalog.kind === 'error') {
    fallbackDiagnostics.push({
      code: 'catalog-unreadable',
      level: 'warning',
      message: 'The archive catalog index could not be read; showing live discovery instead.',
    });
  } else {
    fallbackDiagnostics.push({
      code: 'catalog-absent',
      level: 'info',
      message: 'No archive catalog index has been published yet.',
    });
  }

  if (discovery === null) {
    const error =
      catalog.kind === 'error'
        ? catalog.error
        : new ContentError({
            kind: 'unknown',
            message: 'Live archive discovery failed.',
          });
    return emptySnapshot(
      'error',
      catalog.kind === 'error'
        ? 'The archive catalog could not be read and live discovery failed.'
        : 'Live archive discovery failed.',
      error,
      fallbackDiagnostics,
    );
  }

  const fatal = discovery.errors.length > 0 && merged.listings.length === 0;
  if (fatal) {
    const first = discovery.errors[0];
    return emptySnapshot(
      first && first.kind === 'bridge-unavailable' ? 'unavailable' : 'error',
      'The archive index is unavailable and live discovery could not complete.',
      first ?? null,
      [...fallbackDiagnostics, ...discovery.diagnostics],
    );
  }

  const taxonomy = aggregateTaxonomy(merged.listings);
  return {
    status: 'partial',
    source: 'fallback',
    listings: merged.listings,
    taxonomy,
    compiledAt: null,
    stale: false,
    partial: true,
    message:
      merged.listings.length === 0
        ? 'The archive catalog index is unavailable. A bounded live search found no matching resources; this is not proof that the archive is empty.'
        : 'The archive catalog index is unavailable; showing bounded live search results that may be incomplete.',
    error: null,
    diagnostics: [...fallbackDiagnostics, ...discovery.diagnostics],
  };
}

export interface LoadEntityOptions {
  readonly reader?: QdnReadPort;
  readonly cache?: ContentCache;
  readonly now?: number;
}

function detailStatusForError(error: ContentError): EntityDetailResult['status'] {
  switch (error.kind) {
    case 'bridge-unavailable':
    case 'publisher-unscoped':
      return 'unavailable';
    case 'resource-missing':
      return 'missing';
    case 'unsupported-schema':
      return 'invalid';
    default:
      return 'error';
  }
}

/**
 * Fetch the authoritative entity resource for a detail route.
 *
 * The exact resource identity is derived, then post-filtered, then the payload is
 * runtime-validated and its embedded `id` re-checked against the request.
 */
export async function loadEntityDetail(
  scope: PublisherScope,
  kind: EntityKind,
  reference: string,
  options: LoadEntityOptions = {},
): Promise<EntityDetailResult> {
  if (!scope.scoped) {
    return {
      status: 'unavailable',
      entity: null,
      error: new ContentError({
        kind: 'publisher-unscoped',
        message: unscopedMessage(scope.reason),
      }),
    };
  }
  const entityId = resolveEntityReference(kind, reference);
  if (!entityId) {
    return {
      status: 'invalid',
      entity: null,
      error: new ContentError({ kind: 'malformed', message: 'Invalid entity reference' }),
    };
  }

  const reader = options.reader ?? bridgeQdnReadPort;
  const cache = options.cache ?? getContentCache();
  const identifier = buildEntityIdentifier(kind, entityId);
  const cacheKey = entityCacheKey(scope.name, identifier);

  const cached = await cache.get(cacheKey, ENTITY_CACHE_VERSION);
  let payload: unknown;
  if (cached) {
    payload = cached.value;
  } else {
    const lookup = await findExactResource(reader, {
      service: 'DOCUMENT',
      name: scope.name,
      identifier,
    });
    if (lookup.kind === 'missing') {
      return { status: 'missing', entity: null, error: null };
    }
    if (lookup.kind === 'error') {
      return { status: detailStatusForError(lookup.error), entity: null, error: lookup.error };
    }

    let text: string;
    try {
      text = await reader.fetchText({ service: 'DOCUMENT', name: scope.name, identifier });
    } catch (error) {
      const contentError = toContentError(error);
      return { status: detailStatusForError(contentError), entity: null, error: contentError };
    }
    const parsed = parseJsonPayload(text, LIMITS.entityBytes);
    if (!parsed.ok) {
      return { status: detailStatusForError(parsed.error), entity: null, error: parsed.error };
    }
    payload = parsed.value;
  }

  const validation = validateEntityPayload(payload, { expectedKind: kind });
  if (!validation.ok) {
    return {
      status: 'invalid',
      entity: null,
      error: new ContentError({
        kind: validation.code === 'unsupported-schema' ? 'unsupported-schema' : 'malformed',
        message: validation.message,
      }),
    };
  }
  const entity = validation.value;
  if (entity.id !== entityId || !entityIdentifierMatches(identifier, kind, entityId)) {
    return {
      status: 'invalid',
      entity: null,
      error: new ContentError({
        kind: 'malformed',
        message: 'Entity id does not match the requested resource',
      }),
    };
  }

  if (!cached) {
    await cache.put(cacheKey, payload, {
      ttlMs: CACHE_TTL_MS.entity,
      version: ENTITY_CACHE_VERSION,
    });
  }

  return {
    status: entity.state === 'withdrawn' ? 'withdrawn' : 'ready',
    entity,
    error: null,
  };
}

export interface ListingFilter {
  readonly type?: EntityKind;
  readonly category?: string | null;
  readonly tag?: string | null;
  readonly query?: string | null;
}

/**
 * Local filtering over already-loaded, validated listings. No network access —
 * taxonomy pages and search never issue a request per keystroke or per card.
 */
export function filterListings(
  listings: readonly CatalogListing[],
  filter: ListingFilter = {},
): CatalogListing[] {
  const query = filter.query?.trim().toLowerCase() ?? '';
  return listings.filter((listing) => {
    if (filter.type && listing.type !== filter.type) return false;
    if (filter.category && !taxonomyIncludesSlug(listing.categories, filter.category)) return false;
    if (filter.tag && !taxonomyIncludesSlug(listing.tags, filter.tag)) return false;
    if (query.length === 0) return true;
    const haystack = [
      listing.title,
      listing.excerpt,
      listing.slug,
      ...listing.categories,
      ...listing.tags,
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
}

export interface PageResult<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageCount: number;
  readonly hasPrevious: boolean;
  readonly hasNext: boolean;
}

export function paginate<T>(items: readonly T[], page: number, pageSize: number): PageResult<T> {
  const safePageSize = Math.max(1, pageSize);
  const pageCount = Math.max(1, Math.ceil(items.length / safePageSize));
  const safePage = Math.min(Math.max(1, Number.isFinite(page) ? Math.trunc(page) : 1), pageCount);
  const start = (safePage - 1) * safePageSize;
  return {
    items: items.slice(start, start + safePageSize),
    page: safePage,
    pageCount,
    hasPrevious: safePage > 1,
    hasNext: safePage < pageCount,
  };
}

export function findEntity(
  listings: readonly CatalogListing[],
  kind: EntityKind,
  reference: string,
): CatalogListing | null {
  return listings.find((listing) => listing.type === kind && listing.id === reference) ?? null;
}

export function isEntityFresh(record: CacheRecord<unknown>, now = Date.now()): boolean {
  return isCacheFresh(record, now);
}

export type { ShadowArchiveEntity };
