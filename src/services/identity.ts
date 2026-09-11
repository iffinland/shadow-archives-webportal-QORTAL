import { buildEntityIdentifier, parseEntityIdentifier } from '../domain/identifiers';
import type { EntityKind } from '../domain/constants';
import { ContentError, toContentError } from './errors';
import { normalizeSearchHits, type QdnReadPort, type QdnSearchHit } from './qdnReader';
import type { RequestOptions } from '../qortal';

export interface ExpectedIdentity {
  readonly service: string;
  /** Resource name; compared case-insensitively because QDN names are. */
  readonly name: string;
  /** `null` requests the default (identifier-less) resource. */
  readonly identifier: string | null;
}

/**
 * Exact identity match. Search is a discovery hint: a `(service, name,
 * identifier)` must match exactly, otherwise a substring or prefix collision
 * would be accepted as the intended resource.
 */
export function identityMatches(hit: QdnSearchHit, expected: ExpectedIdentity): boolean {
  if (hit.service !== expected.service) return false;
  if (hit.name.toLowerCase() !== expected.name.toLowerCase()) return false;
  return (hit.identifier ?? null) === (expected.identifier ?? null);
}

export type ExactLookup =
  | { readonly kind: 'found'; readonly hit: QdnSearchHit }
  | { readonly kind: 'missing' }
  | { readonly kind: 'error'; readonly error: ContentError };

export interface FindExactOptions {
  /** Bounded page size; only the exact match is ever returned. */
  readonly searchLimit?: number;
  readonly requestOptions?: RequestOptions;
}

/**
 * Resolve one exact resource under the publisher scope.
 *
 * Always uses `exactMatchNames` plus an exact-identity post-filter. Returns
 * `missing` when the search succeeded but no exact match exists (substring hits
 * are ignored), and `error` when the search itself failed — the two must never be
 * conflated.
 */
export async function findExactResource(
  reader: QdnReadPort,
  expected: ExpectedIdentity,
  options: FindExactOptions = {},
): Promise<ExactLookup> {
  const searchRequest = {
    service: expected.service,
    name: expected.name,
    exactMatchNames: true,
    mode: 'ALL' as const,
    reverse: true,
    limit: options.searchLimit ?? 5,
    ...(expected.identifier === null
      ? { defaultResource: true }
      : { identifier: expected.identifier }),
  };

  try {
    const raw = await reader.search(searchRequest, options.requestOptions);
    const { hits } = normalizeSearchHits(raw);
    const match = hits.find((hit) => identityMatches(hit, expected));
    return match ? { kind: 'found', hit: match } : { kind: 'missing' };
  } catch (error) {
    return { kind: 'error', error: toContentError(error) };
  }
}

export interface EntityIdentity extends ExpectedIdentity {
  readonly service: 'DOCUMENT';
  readonly identifier: string;
}

export function entityIdentity(
  kind: EntityKind,
  id: string,
  publisherName: string,
): EntityIdentity {
  return {
    service: 'DOCUMENT',
    name: publisherName,
    identifier: buildEntityIdentifier(kind, id),
  };
}

/** True when the resource identifier is exactly `prefix + id` for the kind. */
export function entityIdentifierMatches(
  identifier: unknown,
  kind: EntityKind,
  id: string,
): boolean {
  const parsed = parseEntityIdentifier(identifier);
  return parsed !== null && parsed.kind === kind && parsed.id === id;
}
