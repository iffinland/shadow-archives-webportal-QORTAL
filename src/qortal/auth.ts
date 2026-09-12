import { QortalAction } from './actions';
import { PERMISSION_REQUEST_TIMEOUT_MS, QortalBridgeError, request } from './bridge';
import type { QortalAccount, QortalNameData, QortalNameSummary } from './types';

/**
 * Host-mediated, permissioned reads.
 *
 * Required properties (Phase 1A §11.3): a single shared in-flight auth promise,
 * a rejection cached for the session, no automatic retry after rejection, and
 * no component triggering `GET_USER_ACCOUNT` independently.
 *
 * IMPORTANT: nothing in this module runs at startup for an ordinary mount.
 * `requestAccount()` is called from the explicit user action (the Owner/Studio
 * capability flow) and from the tab-scoped owner-mode restore, which runs only
 * when this tab previously marked an explicit owner-mode session in
 * `sessionStorage` (see `ownerModeSession.ts`). The visitor shell therefore
 * never opens a permission dialog.
 *
 * Verified contracts (2026-09-11, Core `108bf191` v6.1.9, Hub `12a573b`):
 * - `GET_USER_ACCOUNT` is host-mediated and returns `{address, publicKey}`.
 * - `GET_ACCOUNT_NAMES` is served by `q-apps.js` as `GET /names/address/{address}`
 *   and returns `NameSummary[]` (`[{name, owner}]`), not bare strings.
 * - `GET_NAME_DATA` is served as `GET /names/{name}` and returns a `NameData`
 *   object whose `owner` is the current owner address.
 * - `GET_PRIMARY_NAME` is host-mediated and returns the primary name string.
 */

let inFlightAccount: Promise<QortalAccount> | null = null;
let sessionAccount: QortalAccount | null = null;
let sessionFailure: QortalBridgeError | null = null;

function isAccount(value: unknown): value is QortalAccount {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.address === 'string' &&
    candidate.address.length > 0 &&
    typeof candidate.publicKey === 'string'
  );
}

/**
 * Single-flight `GET_USER_ACCOUNT`. Rejections are cached for the session so a
 * declined dialog is never replayed automatically.
 */
export function requestAccount(): Promise<QortalAccount> {
  if (sessionAccount) return Promise.resolve(sessionAccount);
  if (sessionFailure) return Promise.reject(sessionFailure);
  if (inFlightAccount) return inFlightAccount;

  inFlightAccount = request<unknown>(
    QortalAction.GET_USER_ACCOUNT,
    {},
    {
      timeoutMs: PERMISSION_REQUEST_TIMEOUT_MS,
    },
  )
    .then((value) => {
      if (!isAccount(value)) {
        throw new QortalBridgeError(
          'malformed',
          'Malformed GET_USER_ACCOUNT response',
          QortalAction.GET_USER_ACCOUNT,
        );
      }
      sessionAccount = value;
      return value;
    })
    .catch((error: unknown) => {
      const failure =
        error instanceof QortalBridgeError
          ? error
          : new QortalBridgeError('error', 'Authentication failed', QortalAction.GET_USER_ACCOUNT);
      // `unavailable` can change during a session (bridge injection timing);
      // every other failure — including a user rejection — must not be
      // retried automatically.
      if (failure.kind !== 'unavailable') sessionFailure = failure;
      inFlightAccount = null;
      throw failure;
    });

  return inFlightAccount;
}

/**
 * Explicit, user-triggered retry after a failure. Clears the cached failure and
 * issues a fresh request; it must only be called from a deliberate user action
 * (the Studio "Try again" control), never from an effect or a poll.
 */
export function retryAccount(): Promise<QortalAccount> {
  if (inFlightAccount) return inFlightAccount;
  sessionFailure = null;
  return requestAccount();
}

export function getSessionAccount(): QortalAccount | null {
  return sessionAccount;
}

/** Drop cached account/permission state. Used by tests and by the Studio reset. */
export function resetAuthSession(): void {
  inFlightAccount = null;
  sessionAccount = null;
  sessionFailure = null;
}

/**
 * Core percent-encodes spaces in `_qdnName`; `q-apps.js` concatenates the name
 * into `/names/{name}` verbatim. Re-encode the path segment so a decoded name
 * with spaces or other reserved characters resolves deterministically.
 */
export function encodeNameForLookup(name: string): string {
  return encodeURIComponent(name);
}

/**
 * `GET_PRIMARY_NAME` — the account's preferred publishing name, if any.
 * Host-mediated; returns `''`/null when the account has no primary name.
 */
export async function getPrimaryName(address: string): Promise<string | null> {
  const value = await request<unknown>(QortalAction.GET_PRIMARY_NAME, { address });
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'object' && value !== null && 'name' in value) {
    const name = (value as { name?: unknown }).name;
    return typeof name === 'string' && name.length > 0 ? name : null;
  }
  return null;
}

function normalizeNameEntry(entry: unknown): QortalNameSummary | null {
  // Current verified shape is a `NameSummary` object. A bare string is
  // tolerated as a name-only entry so a different host implementation cannot
  // silently lose the account's names; the owner stays unknown, which is
  // never treated as authority.
  if (typeof entry === 'string' && entry.length > 0) return { name: entry, owner: '' };
  if (typeof entry !== 'object' || entry === null) return null;
  const candidate = entry as Record<string, unknown>;
  if (typeof candidate.name !== 'string' || candidate.name.length === 0) return null;
  return {
    name: candidate.name,
    owner: typeof candidate.owner === 'string' ? candidate.owner : '',
  };
}

/**
 * `GET_ACCOUNT_NAMES` — every name owned by the address (a user may own
 * several). Multiple names are retained individually; they are never collapsed
 * into one identity. A malformed response throws so the caller can keep the
 * `ownsAnyName` answer unknown instead of inferring "no name".
 */
export async function getAccountNames(address: string): Promise<QortalNameSummary[]> {
  const value = await request<unknown>(QortalAction.GET_ACCOUNT_NAMES, { address });
  if (!Array.isArray(value)) {
    throw new QortalBridgeError(
      'malformed',
      'Malformed GET_ACCOUNT_NAMES response',
      QortalAction.GET_ACCOUNT_NAMES,
    );
  }
  const names: QortalNameSummary[] = [];
  for (const entry of value) {
    const normalized = normalizeNameEntry(entry);
    if (!normalized) {
      throw new QortalBridgeError(
        'malformed',
        'Malformed GET_ACCOUNT_NAMES entry',
        QortalAction.GET_ACCOUNT_NAMES,
      );
    }
    names.push(normalized);
  }
  return names;
}

/**
 * `GET_NAME_DATA` — deliberately does not accept a payload `owner` claim; the
 * owner here is the node-reported current name owner. Returns `null` for a
 * malformed payload so the caller fails closed.
 */
export async function getNameData(name: string): Promise<QortalNameData | null> {
  const value = await request<unknown>(QortalAction.GET_NAME_DATA, {
    name: encodeNameForLookup(name),
  });
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.owner !== 'string' || candidate.owner.length === 0) return null;
  return {
    name: typeof candidate.name === 'string' ? candidate.name : name,
    owner: candidate.owner,
  };
}

/**
 * Ownership is proven by comparing the resolved current owner address with the
 * connected account address. Any lookup failure yields `null` (unknown), never
 * `true`; a successful lookup with a different owner yields `false`.
 */
export async function resolvePublisherOwnership(
  publisherName: string | null,
  account: QortalAccount,
): Promise<boolean | null> {
  if (!publisherName) return null;
  try {
    const data = await getNameData(publisherName);
    if (!data) return null;
    return data.owner === account.address;
  } catch {
    return null;
  }
}
