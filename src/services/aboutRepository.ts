/**
 * About-page read path.
 *
 * The About page is a singleton DOCUMENT resource, so this is a small,
 * purpose-built reader that reuses the shared exact-lookup, payload, cache and
 * scoping primitives. It never issues a write and never widens publisher scope;
 * a read failure is reported truthfully instead of being treated as "no About
 * page".
 */

import {
  ABOUT_PAGE_IDENTIFIER,
  ABOUT_PAGE_SERVICE,
  validateAboutPagePayload,
  type AboutPageDocument,
} from '../domain/aboutPage';
import { CACHE_TTL_MS, LIMITS } from '../domain/constants';
import { getContentCache, isCacheFresh, type ContentCache } from './cache';
import { ContentError, toContentError } from './errors';
import { findExactResource } from './identity';
import { unscopedMessage, type PublisherScope } from './publisher';
import { bridgeQdnReadPort, parseJsonPayload, type QdnReadPort } from './qdnReader';

const ABOUT_CACHE_VERSION = 1;

/** Cache key for the About document under one publishing name. */
export function aboutPageCacheKey(publisherName: string): string {
  return `about:${publisherName.toLowerCase()}`;
}

/** Drop the cached About document (used after a successful publish). */
export async function invalidateAboutCache(
  cache: ContentCache,
  publisherName: string,
): Promise<void> {
  await cache.delete(aboutPageCacheKey(publisherName));
}

/**
 * `ready` — a validated About document was served.
 * `missing` — the search succeeded and there is genuinely no About resource.
 * `invalid` — a resource exists but its payload is malformed/unsupported.
 * `error` — the read itself failed; not the same as `missing`.
 * `unavailable` — the runtime has no publisher scope to read under.
 */
export type AboutPageStatus = 'ready' | 'missing' | 'invalid' | 'error' | 'unavailable';

export interface AboutPageResult {
  readonly status: AboutPageStatus;
  readonly document: AboutPageDocument | null;
  readonly error: ContentError | null;
}

export interface LoadAboutPageOptions {
  readonly reader?: QdnReadPort;
  readonly cache?: ContentCache;
  readonly now?: number;
  /** Skip the cache read (fresh read-back after a write). */
  readonly force?: boolean;
}

export async function loadAboutPage(
  scope: PublisherScope,
  options: LoadAboutPageOptions = {},
): Promise<AboutPageResult> {
  if (!scope.scoped) {
    return {
      status: 'unavailable',
      document: null,
      error: new ContentError({
        kind: 'publisher-unscoped',
        message: unscopedMessage(scope.reason),
      }),
    };
  }

  const reader = options.reader ?? bridgeQdnReadPort;
  const cache = options.cache ?? getContentCache();
  const cacheKey = aboutPageCacheKey(scope.name);
  const now = options.now ?? Date.now();

  if (!options.force) {
    const cached = await cache.get<AboutPageDocument>(cacheKey, ABOUT_CACHE_VERSION);
    if (cached && isCacheFresh(cached, now)) {
      return { status: 'ready', document: cached.value, error: null };
    }
  }

  const lookup = await findExactResource(reader, {
    service: ABOUT_PAGE_SERVICE,
    name: scope.name,
    identifier: ABOUT_PAGE_IDENTIFIER,
  });
  if (lookup.kind === 'missing') return { status: 'missing', document: null, error: null };
  if (lookup.kind === 'error') {
    return { status: 'error', document: null, error: lookup.error };
  }

  let text: string;
  try {
    text = await reader.fetchText({
      service: ABOUT_PAGE_SERVICE,
      name: scope.name,
      identifier: ABOUT_PAGE_IDENTIFIER,
    });
  } catch (error) {
    return { status: 'error', document: null, error: toContentError(error) };
  }

  const parsed = parseJsonPayload(text, LIMITS.entityBytes);
  if (!parsed.ok) return { status: 'error', document: null, error: parsed.error };

  const validation = validateAboutPagePayload(parsed.value);
  if (!validation.ok) {
    return {
      status: 'invalid',
      document: null,
      error: new ContentError({
        kind: validation.code === 'unsupported-schema' ? 'unsupported-schema' : 'malformed',
        message: validation.message,
      }),
    };
  }

  await cache.put(cacheKey, validation.value, {
    ttlMs: CACHE_TTL_MS.entity,
    version: ABOUT_CACHE_VERSION,
  });

  return { status: 'ready', document: validation.value, error: null };
}
