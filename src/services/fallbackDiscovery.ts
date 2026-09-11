import { ENTITY_KINDS, LIMITS, type EntityKind } from '../domain/constants';
import { discoveryPrefix, parseEntityIdentifier } from '../domain/identifiers';
import type { CatalogListing } from '../domain/types';
import { ContentError, toContentError } from './errors';
import type { ArchiveDiagnostic } from './types';
import { runBounded } from './queue';
import { normalizeSearchHits, type QdnReadPort, type QdnSearchHit } from './qdnReader';

export interface FallbackDiscoveryOptions {
  readonly kinds?: readonly EntityKind[];
  readonly pageSize?: number;
  readonly maxPages?: number;
}

export interface FallbackDiscoveryResult {
  readonly listings: readonly CatalogListing[];
  readonly diagnostics: readonly ArchiveDiagnostic[];
  readonly errors: readonly ContentError[];
  /** Always true: bounded prefix search never proves complete coverage. */
  readonly partial: boolean;
  readonly pagesFetched: number;
}

function toListing(hit: QdnSearchHit, kind: EntityKind): CatalogListing | null {
  const parsed = parseEntityIdentifier(hit.identifier);
  if (!parsed || parsed.kind !== kind) return null;
  const createdAt = hit.created ?? 0;
  return {
    id: parsed.id,
    type: kind,
    service: hit.service,
    identifier: hit.identifier as string,
    // Core metadata is a discovery hint only; canonical title/excerpt live in
    // the entity payload and are not fetched for listing cards.
    title: hit.metadata?.title ?? '',
    slug: '',
    excerpt: hit.metadata?.description ?? '',
    createdAt,
    updatedAt: hit.updated ?? createdAt,
    // Core metadata `tags`/`category` are explicitly NOT the canonical taxonomy (D2).
    categories: [],
    tags: [],
    thumbnail: null,
    state: 'active',
    contentHash: null,
    likeCount: null,
    commentCount: null,
    countsCompiledAt: null,
    durationSeconds: null,
    width: null,
    height: null,
    albumId: null,
    partitionIdentifier: 'fallback',
  };
}

async function discoverKind(
  reader: QdnReadPort,
  publisherName: string,
  kind: EntityKind,
  options: Required<Pick<FallbackDiscoveryOptions, 'pageSize' | 'maxPages'>>,
): Promise<FallbackDiscoveryResult> {
  const diagnostics: ArchiveDiagnostic[] = [];
  const errors: ContentError[] = [];
  const listings: CatalogListing[] = [];
  const seen = new Set<string>();
  let pagesFetched = 0;
  let reachedCap = false;
  let failed = false;

  for (let page = 0; page < options.maxPages; page += 1) {
    const offset = page * options.pageSize;
    let raw: unknown[];
    try {
      raw = await reader.search({
        service: 'DOCUMENT',
        name: publisherName,
        exactMatchNames: true,
        identifier: discoveryPrefix(kind),
        prefix: true,
        mode: 'ALL',
        reverse: true,
        includeMetadata: true,
        limit: options.pageSize,
        offset,
      });
    } catch (error) {
      failed = true;
      errors.push(toContentError(error));
      diagnostics.push({
        code: 'fallback-search-failed',
        level: 'error',
        message: `Live discovery for ${kind} failed; results are incomplete.`,
      });
      break;
    }

    pagesFetched += 1;
    const { hits, rejected } = normalizeSearchHits(raw);
    if (rejected > 0) {
      diagnostics.push({
        code: 'fallback-entry-rejected',
        level: 'warning',
        message: `${rejected} live search result(s) for ${kind} had no usable identity.`,
      });
    }
    for (const hit of hits) {
      if (hit.name.toLowerCase() !== publisherName.toLowerCase()) continue;
      if (hit.service !== 'DOCUMENT') continue;
      const listing = toListing(hit, kind);
      if (!listing) continue;
      if (seen.has(listing.identifier)) continue;
      seen.add(listing.identifier);
      listings.push(listing);
    }

    if (raw.length < options.pageSize)
      return { listings, diagnostics, errors, partial: true, pagesFetched };
    reachedCap = page === options.maxPages - 1;
  }

  if (reachedCap || failed) {
    diagnostics.push({
      code: 'fallback-partial',
      level: 'warning',
      message: `Live discovery for ${kind} is bounded and may be incomplete.`,
    });
  }
  return { listings, diagnostics, errors, partial: true, pagesFetched };
}

/**
 * Bounded read-only fallback discovery (task 8) used only when the partitioned
 * catalog is absent or unreadable.
 *
 * - Prefix discovery under the fixed `saw_` namespace, partitioned by kind.
 * - `mode: 'ALL'` is mandatory: Core's default `LATEST` returns only one
 *   resource per (name, service) and would silently hide all but one entity.
 * - Bounded page count and page size; never `limit: 0`.
 * - No full-body fetch: listings carry only search metadata, so a card never
 *   downloads a document body.
 * - Always reported as `partial`: bounded search cannot prove full coverage.
 */
export async function discoverArchive(
  reader: QdnReadPort,
  publisherName: string,
  options: FallbackDiscoveryOptions = {},
): Promise<FallbackDiscoveryResult> {
  const kinds = options.kinds ?? ENTITY_KINDS;
  const bounds = {
    pageSize: options.pageSize ?? LIMITS.searchPageSize,
    maxPages: options.maxPages ?? LIMITS.searchMaxPages,
  };

  const results = await runBounded(kinds, LIMITS.entityConcurrency, (kind) =>
    discoverKind(reader, publisherName, kind, bounds),
  );

  const listings: CatalogListing[] = [];
  const diagnostics: ArchiveDiagnostic[] = [];
  const errors: ContentError[] = [];
  const seen = new Set<string>();
  let pagesFetched = 0;

  for (const result of results) {
    if (!result.ok) {
      errors.push(toContentError(result.error));
      continue;
    }
    pagesFetched += result.value.pagesFetched;
    diagnostics.push(...result.value.diagnostics);
    errors.push(...result.value.errors);
    for (const listing of result.value.listings) {
      if (seen.has(listing.identifier)) continue;
      seen.add(listing.identifier);
      listings.push(listing);
    }
  }

  listings.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
  return { listings, diagnostics, errors, partial: true, pagesFetched };
}
