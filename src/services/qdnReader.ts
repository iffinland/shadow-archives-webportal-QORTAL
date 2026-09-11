import {
  fetchQdnResourceText,
  searchQdnResources,
  type QdnResourceRef,
  type QdnSearchRequest,
  type RequestOptions,
} from '../qortal';
import { ContentError } from './errors';
import { isRecord, optionalString } from '../domain/validation';

/** Normalized `SEARCH_QDN_RESOURCES` result item (node `ArbitraryResourceData`). */
export interface QdnSearchHit {
  readonly service: string;
  readonly name: string;
  /** `null` means the resource has no identifier (the default resource). */
  readonly identifier: string | null;
  readonly created: number | null;
  readonly updated: number | null;
  readonly size: number | null;
  readonly status: string | null;
  readonly metadata: {
    readonly title: string | null;
    readonly description: string | null;
    readonly tags: readonly string[];
    readonly category: string | null;
    readonly mimeType: string | null;
  } | null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readStatus(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (isRecord(value) && typeof value.status === 'string' && value.status.length > 0) {
    return value.status;
  }
  return null;
}

function readMetadata(value: unknown): QdnSearchHit['metadata'] {
  if (!isRecord(value)) return null;
  const tags: string[] = [];
  if (Array.isArray(value.tags)) {
    for (const tag of value.tags) {
      if (typeof tag === 'string' && tag.length > 0) tags.push(tag);
    }
  }
  const metadata = {
    title: optionalString(value.title, 512),
    description: optionalString(value.description, 2048),
    tags,
    category: optionalString(value.category, 64),
    mimeType: optionalString(value.mimeType, 128),
  };
  const hasAny =
    metadata.title !== null ||
    metadata.description !== null ||
    metadata.tags.length > 0 ||
    metadata.category !== null;
  return hasAny ? metadata : null;
}

/**
 * Normalize one raw search result. Returns null for items without a usable
 * `name`/`service` identity; the caller counts that as a diagnostic.
 */
export function normalizeSearchHit(raw: unknown): QdnSearchHit | null {
  if (!isRecord(raw)) return null;
  const name = optionalString(raw.name, 128);
  const service = optionalString(raw.service, 32);
  if (!name || !service) return null;
  const identifier = optionalString(raw.identifier, 64);
  return {
    service,
    name,
    identifier,
    created: readNumber(raw.created),
    updated: readNumber(raw.updated),
    size: readNumber(raw.size),
    status: readStatus(raw.status),
    metadata: readMetadata(raw.metadata),
  };
}

export function normalizeSearchHits(raw: readonly unknown[]): {
  hits: QdnSearchHit[];
  rejected: number;
} {
  const hits: QdnSearchHit[] = [];
  let rejected = 0;
  for (const item of raw) {
    const hit = normalizeSearchHit(item);
    if (hit) hits.push(hit);
    else rejected += 1;
  }
  return { hits, rejected };
}

/**
 * Transport port. The default implementation is the verified bridge; tests
 * inject a fake, and some tests exercise the real bridge through a fake
 * `window.qortalRequest` to prove the field mapping.
 */
export interface QdnReadPort {
  search(request: QdnSearchRequest, options?: RequestOptions): Promise<unknown[]>;
  fetchText(ref: QdnResourceRef, options?: RequestOptions): Promise<string>;
}

export const bridgeQdnReadPort: QdnReadPort = {
  search: searchQdnResources,
  fetchText: fetchQdnResourceText,
};

export type ParsedPayload =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: ContentError };

/** Parse a bounded JSON payload without ever throwing. */
export function parseJsonPayload(text: string, cap: number): ParsedPayload {
  if (text.length > cap) {
    return {
      ok: false,
      error: new ContentError({
        kind: 'oversized',
        message: `QDN payload exceeds the ${cap}-character cap`,
      }),
    };
  }
  if (text.trim().length === 0) {
    return {
      ok: false,
      error: new ContentError({ kind: 'malformed', message: 'QDN payload is empty' }),
    };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      error: new ContentError({ kind: 'malformed', message: 'QDN payload is not valid JSON' }),
    };
  }
}
