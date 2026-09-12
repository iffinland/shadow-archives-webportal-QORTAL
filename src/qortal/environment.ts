import { hasQortalBridge } from './bridgeGlobal';
import type { QdnEnvironment, QortalRuntimeState } from './types';

export { hasQortalBridge, resolveQortalRequest } from './bridgeGlobal';
export type { QortalRequestFunction } from './bridgeGlobal';

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

export interface RuntimeStateInput {
  readonly bridgeAvailable: boolean;
  /** True when any `_qdn*` value was injected (the frame was served by Qortal). */
  readonly isQortalFrame: boolean;
  readonly isProxy: boolean;
}

/**
 * The single derivation of the explicit runtime state.
 *
 * This is the rule that must never be collapsed: `isQortalFrame && !bridge`
 * (a published read-only render context) is a *different* state from
 * `!isQortalFrame && !bridge` (a plain browser).
 */
export function deriveRuntimeState(input: RuntimeStateInput): QortalRuntimeState {
  if (input.isProxy) return 'qortal-dev-proxy';
  if (input.isQortalFrame) {
    return input.bridgeAvailable ? 'qortal-host' : 'qortal-render-readonly';
  }
  return input.bridgeAvailable ? 'qortal-bridge-unidentified' : 'plain-browser';
}

/**
 * Read the injected `_qdn*` globals into a typed, immutable context object.
 * Pure with respect to the passed window, which keeps it testable.
 */
export function readQdnEnvironment(target: Window = window): QdnEnvironment {
  const context = readString(target._qdnContext);
  const rawName = readString(target._qdnName);
  const service = readString(target._qdnService);
  const publisherName = decodeQdnName(rawName);
  const bridgeAvailable = hasQortalBridge(target);
  const base = readString(target._qdnBase) ?? '';
  const baseWithPath = readString(target._qdnBaseWithPath);

  // Any injected `_qdn*` value proves a Qortal runtime served this document.
  // Core's HTMLParser always writes `_qdnContext` and `_qdnService`, so this is
  // true for `render`, `gateway`, `domainMap` and the node dev proxy, and false
  // in a plain browser.
  const isQortalFrame = context !== null || rawName !== null || service !== null;
  const isProxy = context === 'proxy';

  return Object.freeze({
    bridgeAvailable,
    isHosted: isQortalFrame,
    hasQdnIdentity: publisherName !== null && publisherName.trim().length > 0,
    runtimeState: deriveRuntimeState({ bridgeAvailable, isQortalFrame, isProxy }),
    context,
    isProxy,
    service,
    name: rawName,
    publisherName,
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
