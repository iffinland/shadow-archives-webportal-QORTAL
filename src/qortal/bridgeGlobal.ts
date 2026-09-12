/**
 * Resolution of the injected `qortalRequest` bridge.
 *
 * VERIFIED 2026-09-12 against Core `108bf191` (v6.1.9):
 * `src/main/resources/q-apps/q-apps.js`, `src/main/java/org/qortal/api/HTMLParser.java`,
 * `src/main/java/org/qortal/api/resource/AppsResource.java`.
 *
 * 1. Core prepends `/apps/q-apps.js` to the document head as a **classic**
 *    script (`HTMLParser.addAdditionalHeaderTags`).
 * 2. That script declares the bridge with a top-level `const`:
 *    `const qortalRequest = (request) => { ... }`.
 * 3. A top-level `const`/`let`/`class` in a classic script creates a binding in
 *    the global *declarative* environment record. It is reachable as the bare
 *    identifier `qortalRequest` from every script in the realm — including the
 *    app's ES modules — but it is **not** a property of `window`.
 *
 * Core never assigns `window.qortalRequest` (verified: no such assignment exists
 * anywhere under `qortal/src/main/**`). The sanctioned framework and the
 * reference apps all read the bare global instead:
 * `qapp-core/src/global.ts` declares `function qortalRequest(...)`,
 * `Subwire/src/utils/articleQdn.ts` declares `const qortalRequest`
 * (`declare const`), and q-tube/qapp-core call the bare identifier.
 *
 * Detecting only `window.qortalRequest` therefore reports "no bridge" inside a
 * real `/render/<service>/<name>` frame on the pinned Core revision. Both access
 * styles are supported here; the bare global is authoritative for this
 * revision, and the `window` property keeps compatibility with any host that
 * attaches the function directly.
 */

/** The callable shape of the injected bridge (`q-apps.js` `qortalRequest`). */
export type QortalRequestFunction = (request: Record<string, unknown>) => Promise<unknown>;

/**
 * Read the bare global binding created by the injected `q-apps.js`.
 *
 * `typeof` on an *undeclared* identifier is safe and yields `'undefined'`.
 * A `let`/`const` binding that exists but has not been initialised yet sits in
 * its temporal dead zone, where even `typeof` throws, so the read is guarded.
 */
function readBareGlobalQortalRequest(): QortalRequestFunction | null {
  try {
    if (typeof qortalRequest === 'function') return qortalRequest;
  } catch {
    // Temporal dead zone (the shim has not executed yet) or a hostile accessor.
  }
  return null;
}

function readWindowQortalRequest(target: Window): QortalRequestFunction | null {
  const candidate = (target as unknown as { qortalRequest?: unknown }).qortalRequest;
  return typeof candidate === 'function' ? (candidate as QortalRequestFunction) : null;
}

/**
 * The bare global binding is only meaningful for the real global object. Tests
 * pass synthetic window-like objects, which must not accidentally pick up a
 * global left behind by another test.
 */
function isRealGlobalTarget(target: Window): boolean {
  if (target === (globalThis as unknown as Window)) return true;
  return typeof window !== 'undefined' && target === window;
}

/**
 * Resolve the callable bridge for a window, or `null` when none is reachable.
 *
 * Never throws: a blocked or absent global is reported as "unavailable" so the
 * runtime state machine can classify it truthfully.
 */
export function resolveQortalRequest(target: Window = window): QortalRequestFunction | null {
  const fromWindow = readWindowQortalRequest(target);
  if (fromWindow) return fromWindow;
  if (!isRealGlobalTarget(target)) return null;
  return readBareGlobalQortalRequest();
}

/** True when a callable `qortalRequest` bridge is reachable for this window. */
export function hasQortalBridge(target: Window = window): boolean {
  return resolveQortalRequest(target) !== null;
}
