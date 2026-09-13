/**
 * Verified QDN read primitives.
 *
 * Every field name here was read from the current injected bridge implementation
 * (`qortal/src/main/resources/q-apps/q-apps.js`, verified 2026-09-11 against
 * Core `108bf191` / v6.1.9). Bridge `SEARCH_QDN_RESOURCES` fields are camelCase
 * and differ from the node's lowercase REST query names; lowercase REST names
 * passed to the bridge are silently ignored, so the mapping is explicit here and
 * must not be "simplified".
 *
 * These wrappers return untrusted raw values. Runtime validation happens in the
 * domain layer; nothing here fabricates a domain value.
 */

import { request, type RequestOptions } from './bridge';
import { QortalAction } from './actions';

/** `mode` is a Core `SearchMode`. Default is `LATEST` (one resource per name+service). */
export type QdnSearchMode = 'ALL' | 'LATEST';

/**
 * `SEARCH_QDN_RESOURCES` parameters, named after the bridge fields.
 *
 * `defaultResource` maps to the bridge field `default`, and `nameListFilter` to
 * `nameListFilter` (which `q-apps.js` translates to the REST `namefilter`).
 */
export interface QdnSearchRequest {
  readonly service?: string;
  readonly query?: string;
  readonly identifier?: string;
  readonly name?: string;
  readonly names?: readonly string[];
  readonly keywords?: readonly string[];
  readonly title?: string;
  readonly description?: string;
  readonly prefix?: boolean;
  readonly exactMatchNames?: boolean;
  /** Bridge field `default`: only resources without identifiers. */
  readonly defaultResource?: boolean;
  readonly mode?: QdnSearchMode;
  readonly minLevel?: number;
  readonly includeStatus?: boolean;
  readonly includeMetadata?: boolean;
  readonly nameListFilter?: string;
  readonly followedOnly?: boolean;
  readonly excludeBlocked?: boolean;
  readonly before?: number;
  readonly after?: number;
  readonly limit?: number;
  readonly offset?: number;
  readonly reverse?: boolean;
}

export interface QdnResourceRef {
  readonly service: string;
  readonly name: string;
  /** Omit or null for the resource's default (no identifier). */
  readonly identifier?: string | null;
  readonly path?: string | null;
}

/** Translate the typed request into the exact bridge payload keys. */
export function toBridgeSearchParams(params: QdnSearchRequest): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (params.service !== undefined) payload.service = params.service;
  if (params.query !== undefined) payload.query = params.query;
  if (params.identifier !== undefined) payload.identifier = params.identifier;
  if (params.name !== undefined) payload.name = params.name;
  if (params.names !== undefined) payload.names = [...params.names];
  if (params.keywords !== undefined) payload.keywords = [...params.keywords];
  if (params.title !== undefined) payload.title = params.title;
  if (params.description !== undefined) payload.description = params.description;
  if (params.prefix !== undefined) payload.prefix = params.prefix;
  if (params.exactMatchNames !== undefined) payload.exactMatchNames = params.exactMatchNames;
  if (params.defaultResource !== undefined) payload.default = params.defaultResource;
  if (params.mode !== undefined) payload.mode = params.mode;
  if (params.minLevel !== undefined) payload.minLevel = params.minLevel;
  if (params.includeStatus !== undefined) payload.includeStatus = params.includeStatus;
  if (params.includeMetadata !== undefined) payload.includeMetadata = params.includeMetadata;
  if (params.nameListFilter !== undefined) payload.nameListFilter = params.nameListFilter;
  if (params.followedOnly !== undefined) payload.followedOnly = params.followedOnly;
  if (params.excludeBlocked !== undefined) payload.excludeBlocked = params.excludeBlocked;
  if (params.before !== undefined) payload.before = params.before;
  if (params.after !== undefined) payload.after = params.after;
  if (params.limit !== undefined) payload.limit = params.limit;
  if (params.offset !== undefined) payload.offset = params.offset;
  if (params.reverse !== undefined) payload.reverse = params.reverse;
  return payload;
}

/** Raw search result items; the caller validates each item. */
export async function searchQdnResources(
  params: QdnSearchRequest,
  options: RequestOptions = {},
): Promise<unknown[]> {
  const result = await request<unknown>(
    QortalAction.SEARCH_QDN_RESOURCES,
    toBridgeSearchParams(params),
    options,
  );
  if (!Array.isArray(result)) {
    throw new Error('SEARCH_QDN_RESOURCES did not return an array');
  }
  return result;
}

/**
 * Fetch one single-file resource as text (`FETCH_QDN_RESOURCE`).
 *
 * No `encoding` is supplied, so the node returns the resource bytes; a
 * Shadow Archives `DOCUMENT` envelope is UTF-8 JSON.
 *
 * VERIFIED RESPONSE SHAPE (live `/render/APP/Shadow Archives` frame through the
 * injected bridge, 2026-09-13, Core `108bf191` / v6.1.9). The shim's
 * `handleResponse()` runs every `FETCH_QDN_RESOURCE` body through `JSON.parse`
 * and posts the **parsed value** back as the bridge result; it falls back to the
 * raw `response.text()` only when the body is not JSON. A JSON `DOCUMENT` body
 * therefore arrives as an object, not as text, so a string-only check rejects
 * every real entity/catalog read with "FETCH_QDN_RESOURCE did not return text".
 * Binary and other non-JSON bodies still arrive as strings.
 *
 * Normalizing here (the layer that owns the bridge response contract) keeps the
 * `QdnReadPort.fetchText(): Promise<string>` contract intact for the whole
 * domain/validation layer. A JSON round trip preserves the values the validators
 * consume; it does not preserve source formatting or key order, and nothing in
 * the domain layer depends on either.
 */

/** Normalize a raw `FETCH_QDN_RESOURCE` bridge result to text, or `null`. */
export function bridgeFetchResultToText(result: unknown): string | null {
  if (typeof result === 'string') return result;
  if (Array.isArray(result) || (typeof result === 'object' && result !== null)) {
    try {
      return JSON.stringify(result);
    } catch {
      return null;
    }
  }
  return null;
}

export async function fetchQdnResourceText(
  ref: QdnResourceRef,
  options: RequestOptions = {},
): Promise<string> {
  const params: Record<string, unknown> = { service: ref.service, name: ref.name };
  if (ref.identifier) params.identifier = ref.identifier;
  if (ref.path) params.filepath = ref.path;
  const result = await request<unknown>(QortalAction.FETCH_QDN_RESOURCE, params, options);
  const text = bridgeFetchResultToText(result);
  if (text === null) {
    throw new Error('FETCH_QDN_RESOURCE did not return text');
  }
  return text;
}

/** Raw status response; the caller validates `status`. */
export async function getQdnResourceStatus(
  ref: QdnResourceRef,
  options: RequestOptions = {},
): Promise<unknown> {
  const params: Record<string, unknown> = { service: ref.service, name: ref.name };
  if (ref.identifier) params.identifier = ref.identifier;
  return request<unknown>(QortalAction.GET_QDN_RESOURCE_STATUS, params, options);
}

/**
 * Authoritative media URL from the bridge (`GET_QDN_RESOURCE_URL`).
 *
 * The bridge runs a status check before building the URL, so this is an
 * on-demand lookup, not a listing primitive.
 */
export async function getQdnResourceUrl(
  ref: QdnResourceRef,
  options: RequestOptions = {},
): Promise<string> {
  const params: Record<string, unknown> = { service: ref.service, name: ref.name };
  if (ref.identifier) params.identifier = ref.identifier;
  if (ref.path) params.path = ref.path;
  const result = await request<unknown>(QortalAction.GET_QDN_RESOURCE_URL, params, options);
  if (typeof result !== 'string' || result.length === 0) {
    throw new Error('GET_QDN_RESOURCE_URL did not return a URL');
  }
  return result;
}

/**
 * Same-origin media path, mirroring the verified non-link branch of the
 * injected `buildResourceUrl()` in `q-apps.js`:
 *
 *   /arbitrary/<service>/<name>[/<identifier>][?filepath=<path>]
 *
 * This avoids an extra `GET_QDN_RESOURCE_URL` status round-trip per listing
 * thumbnail. Real-host media rendering remains OWNER VALIDATION REQUIRED.
 */
export function buildQdnResourcePath(ref: QdnResourceRef, filepath?: string): string {
  let url = `/arbitrary/${encodeURIComponent(ref.service)}/${encodeURIComponent(ref.name)}`;
  if (ref.identifier) url += `/${encodeURIComponent(ref.identifier)}`;
  const path = filepath ?? ref.path ?? null;
  if (path) url += `?filepath=${encodeURIComponent(path)}`;
  return url;
}

/* -------------------------------------------------------------------------- */
/* Same-origin REST fallback (read-only)                                      */
/* -------------------------------------------------------------------------- */

/**
 * `SEARCH_QDN_RESOURCES` as the node's **lowercase** REST query names.
 *
 * This mirrors the verified branch of the injected `q-apps.js`
 * `window.addEventListener("message", ...)` handler for `SEARCH_QDN_RESOURCES`,
 * which builds `/arbitrary/resources/search?` and concatenates lowercase
 * parameters (`exactmatchnames`, `minlevel`, `includestatus`,
 * `includemetadata`, `namefilter`, `followedonly`, `excludeblocked`,
 * `default`, repeated `name` for `names`).
 *
 * The bridge namespace is camelCase and the REST namespace is lowercase; they
 * are different contracts and must not be unified.
 *
 * Values are percent-encoded with `encodeURIComponent`, which yields the same
 * wire form the browser's URL parser produces for `q-apps.js`'s raw
 * concatenation (a space becomes `%20`).
 */
export function toSameOriginSearchQuery(params: QdnSearchRequest): string {
  const parts: string[] = [];
  const add = (key: string, value: string | number | boolean | undefined): void => {
    if (value === undefined) return;
    parts.push(`${key}=${encodeURIComponent(String(value))}`);
  };

  add('service', params.service);
  add('query', params.query);
  add('identifier', params.identifier);
  add('name', params.name);
  for (const name of params.names ?? []) add('name', name);
  for (const keyword of params.keywords ?? []) add('keywords', keyword);
  add('title', params.title);
  add('description', params.description);
  add('prefix', params.prefix);
  add('exactmatchnames', params.exactMatchNames);
  add('default', params.defaultResource);
  add('mode', params.mode);
  add('minlevel', params.minLevel);
  add('includestatus', params.includeStatus);
  add('includemetadata', params.includeMetadata);
  add('namefilter', params.nameListFilter);
  add('followedonly', params.followedOnly);
  add('excludeblocked', params.excludeBlocked);
  add('before', params.before);
  add('after', params.after);
  add('limit', params.limit);
  add('offset', params.offset);
  add('reverse', params.reverse);

  return parts.join('&');
}

/** Same-origin search path, exactly as the injected shim requests it. */
export function buildSameOriginSearchPath(params: QdnSearchRequest): string {
  return `/arbitrary/resources/search?${toSameOriginSearchQuery(params)}`;
}

/**
 * Same-origin status path (`GET_QDN_RESOURCE_STATUS`).
 * Verified shim route: `/arbitrary/resource/status/{service}/{name}[/{identifier}]`.
 */
export function buildSameOriginStatusPath(ref: QdnResourceRef): string {
  let url = `/arbitrary/resource/status/${encodeURIComponent(ref.service)}/${encodeURIComponent(ref.name)}`;
  if (ref.identifier) url += `/${encodeURIComponent(ref.identifier)}`;
  return url;
}
