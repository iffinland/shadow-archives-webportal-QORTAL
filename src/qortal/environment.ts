import type { QdnEnvironment } from './types';

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

/**
 * Core percent-encodes spaces in `_qdnName` (`Shadow Archives` ->
 * `Shadow%20Archives`). Decode for display and for name comparisons; re-encode
 * only when calling a node endpoint such as `/names/{name}`.
 *
 * A malformed escape sequence is returned unchanged rather than throwing; the
 * value is still usable as an opaque identifier.
 */
export function decodeQdnName(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** True when a `qortalRequest` bridge function is available on the given window. */
export function hasQortalBridge(target: Window = window): boolean {
  return typeof target.qortalRequest === 'function';
}

/**
 * Read the injected `_qdn*` globals into a typed, immutable context object.
 * Pure with respect to the passed window, which keeps it testable.
 */
export function readQdnEnvironment(target: Window = window): QdnEnvironment {
  const context = readString(target._qdnContext);
  const rawName = readString(target._qdnName);
  const bridgeAvailable = hasQortalBridge(target);
  const base = readString(target._qdnBase) ?? '';
  const baseWithPath = readString(target._qdnBaseWithPath);

  return Object.freeze({
    bridgeAvailable,
    isHosted: bridgeAvailable && (context !== null || rawName !== null),
    context,
    isProxy: context === 'proxy',
    service: readString(target._qdnService),
    name: rawName,
    publisherName: decodeQdnName(rawName),
    identifier: readString(target._qdnIdentifier),
    path: readString(target._qdnPath),
    lang: readString(target._qdnLang),
    base,
    baseWithPath,
  });
}

let cachedEnvironment: QdnEnvironment | null = null;

/**
 * Read the environment once per document. Prefer `useQortalEnvironment()`
 * inside React; this accessor exists for non-React consumers such as router
 * basename resolution and QDN URL builders.
 */
export function getQdnEnvironment(): QdnEnvironment {
  cachedEnvironment ??= readQdnEnvironment();
  return cachedEnvironment;
}

/** Test/dev helper: drop the memoized environment so a fresh window can be read. */
export function resetQdnEnvironmentCache(): void {
  cachedEnvironment = null;
}

/**
 * Router basename. `_qdnBase` is correct for an `APP` resource whose route is
 * auto-served from `index.html`; it is empty in the dev proxy and in a plain
 * browser, where the app is served from the origin root.
 */
export function getRouterBasename(target: Window = window): string {
  return readString(target._qdnBase) ?? '';
}
