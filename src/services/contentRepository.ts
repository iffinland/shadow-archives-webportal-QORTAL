import { CACHE_TTL_MS, LIMITS, type EntityKind } from '../domain/constants';
import { validateEntityPayload } from '../domain/entities';
import { buildEntityIdentifier, resolveEntityReference } from '../domain/identifiers';
import { dedupeTaxonomy, taxonomyIncludesSlug, toTaxonomyReference } from '../domain/taxonomy';
import type { CatalogListing, ShadowArchiveEntity, TaxonomyReference } from '../domain/types';
import { getContentCache, isCacheFresh, type CacheRecord, type ContentCache } from './cache';
import { loadCatalog } from './catalogRepository';
import { ContentError, toContentError } from './errors';
import { discoverArchive } from './fallbackDiscovery';
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
 * Load the archive snapshot.
 *
 * Catalog first (authoritative entity resources remain the source of truth), then
 * a bounded read-only fallback when the catalog is absent, corrupt or
 * unsupported. A failed catalog *read* (network) is reported as an error rather
 * than silently retried as a fallback discovery.
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

  let catalog;
  try {
    catalog = await loadCatalog(reader, cache, scope.name, { now, force: options.force });
  } catch (error) {
    return emptySnapshot('error', 'Archive discovery failed.', toContentError(error));
  }

  if (catalog.kind === 'loaded') {
    const listings = catalog.listings;
    const taxonomy = aggregateTaxonomy(listings);
    const diagnostics = catalog.diagnostics;
    const base = {
      source: 'catalog' as const,
      listings,
      taxonomy,
      compiledAt: catalog.manifest.compiledAt,
      stale: catalog.stale,
      partial: catalog.partial,
      diagnostics,
    };

    if (listings.length === 0) {
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

  if (catalog.kind === 'error') {
    return emptySnapshot('error', 'The archive catalog could not be read.', catalog.error);
  }

  // Catalog is missing or structurally unusable: bounded live discovery.
  const fallbackDiagnostics: ArchiveDiagnostic[] = [];
  if (catalog.kind === 'invalid') {
    fallbackDiagnostics.push({
      code: 'catalog-invalid',
      level: 'warning',
      message: 'The archive catalog index is unavailable or invalid.',
    });
  } else {
    fallbackDiagnostics.push({
      code: 'catalog-absent',
      level: 'info',
      message: 'No archive catalog index has been published yet.',
    });
  }

  let discovery;
  try {
    discovery = await discoverArchive(reader, scope.name);
  } catch (error) {
    return emptySnapshot(
      'error',
      'Live archive discovery failed.',
      toContentError(error),
      fallbackDiagnostics,
    );
  }

  const fatal = discovery.errors.length > 0 && discovery.listings.length === 0;
  if (fatal) {
    const first = discovery.errors[0];
    return emptySnapshot(
      first && first.kind === 'bridge-unavailable' ? 'unavailable' : 'error',
      'The archive index is unavailable and live discovery could not complete.',
      first ?? null,
      [...fallbackDiagnostics, ...discovery.diagnostics],
    );
  }

  const taxonomy = aggregateTaxonomy(discovery.listings);
  return {
    status: 'partial',
    source: 'fallback',
    listings: discovery.listings,
    taxonomy,
    compiledAt: null,
    stale: false,
    partial: true,
    message:
      discovery.listings.length === 0
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
