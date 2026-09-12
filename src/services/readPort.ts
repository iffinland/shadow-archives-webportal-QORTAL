/**
 * Read-only QDN transports.
 *
 * Two verified transports exist for the same read actions:
 *
 * 1. **Bridge** (`bridgeQdnReadPort`, `src/services/qdnReader.ts`) — the injected
 *    `q-apps.js` request function. Handled locally by the shim for public reads
 *    and host-mediated for permissioned actions.
 * 2. **Same-origin REST** (`sameOriginQdnReadPort`, this module) — the exact
 *    routes the injected shim itself issues with `fetch()` in the frame the node
 *    served. VERIFIED 2026-09-12 against Core `108bf191` (v6.1.9)
 *    `src/main/resources/q-apps/q-apps.js`:
 *      - `SEARCH_QDN_RESOURCES`  -> `GET /arbitrary/resources/search?<lowercase params>`
 *      - `FETCH_QDN_RESOURCE`    -> `GET /arbitrary/{service}/{name}[/{identifier}][?filepath=]`
 *      - `GET_QDN_RESOURCE_STATUS` -> `GET /arbitrary/resource/status/{service}/{name}[/{identifier}]`
 *      - `GET_QDN_RESOURCE_URL`  -> status check, then `/arbitrary/{service}/{name}[/{identifier}]`
 *
 * Why the second transport is needed: a published `render` frame always injects
 * the authoritative `_qdn*` identity, but the host bridge is not guaranteed to be
 * reachable in that frame. Without a fallback, read-only browsing of a genuinely
 * published archive would be impossible — a regression the published runtime
 * exposed (Gallery reported "no production publisher identity").
 *
 * Scope discipline: this port is READ-ONLY. No write, signing, account or
 * permissioned action may be routed through it. Writes stay bridge-only and
 * owner-gated (`src/qortal/publish.ts` + `galleryPublishService` authority check).
 */

import { QortalAction } from '../qortal/actions';
import { QortalBridgeError } from '../qortal/bridge';
import {
  buildQdnResourcePath,
  buildSameOriginSearchPath,
  buildSameOriginStatusPath,
  type QdnResourceRef,
  type QdnSearchRequest,
  type RequestOptions,
} from '../qortal';
import type { QdnEnvironment } from '../qortal/types';
import { bridgeQdnReadPort, type QdnReadPort } from './qdnReader';

/** Bounded deadline for one same-origin read; matches the bridge default. */
export const SAME_ORIGIN_READ_TIMEOUT_MS = 20_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function resolveFetch(target?: Window): FetchLike | null {
  const candidate = (target ?? globalThis) as unknown as { fetch?: unknown };
  return typeof candidate.fetch === 'function' ? (candidate.fetch as FetchLike) : null;
}

/** `{"error": "..."}` bodies become failures, exactly as the shim treats them. */
function readErrorPayload(text: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const error = (parsed as Record<string, unknown>).error;
  if (typeof error === 'string' && error.length > 0) return error;
  if (error !== undefined && error !== null) return 'QDN read failed';
  return null;
}

/**
 * One bounded, same-origin GET returning the raw response body as text.
 *
 * Failure classification reuses the bridge taxonomy so callers (`ContentError`)
 * keep distinguishing timeout / network / malformed instead of collapsing them.
 */
async function sameOriginGetText(
  path: string,
  action: string,
  options: RequestOptions,
): Promise<string> {
  const fetchFn = resolveFetch(options.target);
  if (!fetchFn) {
    throw new QortalBridgeError(
      'unavailable',
      'No same-origin fetch is available in this runtime',
      action,
    );
  }

  const timeoutMs = options.timeoutMs ?? SAME_ORIGIN_READ_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  options.signal?.addEventListener('abort', forwardAbort, { once: true });

  try {
    const response = await fetchFn(path, {
      signal: controller.signal,
      headers: { accept: 'application/json, text/plain, */*' },
    });
    const text = await response.text();

    if (!response.ok) {
      throw new QortalBridgeError(
        'error',
        `${action} failed with HTTP ${response.status}`,
        action,
        { status: response.status },
      );
    }
    if (text.length === 0) {
      throw new QortalBridgeError('malformed', `Empty response: ${action}`, action);
    }
    const errorPayload = readErrorPayload(text);
    if (errorPayload !== null) {
      throw new QortalBridgeError('error', errorPayload, action);
    }
    return text;
  } catch (error) {
    if (error instanceof QortalBridgeError) throw error;
    if (controller.signal.aborted) {
      throw new QortalBridgeError(
        timedOut ? 'timeout' : 'error',
        timedOut ? `Request timed out: ${action}` : `Request aborted: ${action}`,
        action,
      );
    }
    throw new QortalBridgeError('error', `Same-origin QDN read failed: ${action}`, action, error);
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}

/** Read-only same-origin transport. Never used for writes or account access. */
export const sameOriginQdnReadPort: QdnReadPort = {
  async search(params: QdnSearchRequest, options: RequestOptions = {}): Promise<unknown[]> {
    const text = await sameOriginGetText(
      buildSameOriginSearchPath(params),
      QortalAction.SEARCH_QDN_RESOURCES,
      options,
    );
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw new QortalBridgeError(
        'malformed',
        'SEARCH_QDN_RESOURCES did not return JSON',
        QortalAction.SEARCH_QDN_RESOURCES,
      );
    }
    if (!Array.isArray(parsed)) {
      throw new QortalBridgeError(
        'malformed',
        'SEARCH_QDN_RESOURCES did not return an array',
        QortalAction.SEARCH_QDN_RESOURCES,
      );
    }
    return parsed;
  },

  async fetchText(ref: QdnResourceRef, options: RequestOptions = {}): Promise<string> {
    return sameOriginGetText(buildQdnResourcePath(ref), QortalAction.FETCH_QDN_RESOURCE, options);
  },
};

/** Same-origin resource status read (not used by the current read repository). */
export async function getSameOriginResourceStatus(
  ref: QdnResourceRef,
  options: RequestOptions = {},
): Promise<unknown> {
  const text = await sameOriginGetText(
    buildSameOriginStatusPath(ref),
    QortalAction.GET_QDN_RESOURCE_STATUS,
    options,
  );
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new QortalBridgeError(
      'malformed',
      'GET_QDN_RESOURCE_STATUS did not return JSON',
      QortalAction.GET_QDN_RESOURCE_STATUS,
    );
  }
}

/**
 * Select the transport for the current runtime state.
 *
 * - `qortal-host` / `qortal-bridge-unidentified` -> bridge (the shim is present).
 * - `qortal-render-readonly` -> same-origin REST: the publishing identity is
 *   real and the node that served this document answers the same read routes.
 * - `plain-browser` -> bridge port, which fails closed as `unavailable` rather
 *   than inventing data from an unrelated origin.
 */
export function resolveQdnReadPort(environment: QdnEnvironment): QdnReadPort {
  if (environment.bridgeAvailable) return bridgeQdnReadPort;
  if (environment.runtimeState === 'qortal-render-readonly') return sameOriginQdnReadPort;
  return bridgeQdnReadPort;
}
