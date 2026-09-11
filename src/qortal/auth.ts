import { QortalAction } from './actions';
import { PERMISSION_REQUEST_TIMEOUT_MS, QortalBridgeError, request } from './bridge';
import type { QortalAccount, QortalNameData } from './types';

/**
 * Host-mediated, permissioned reads.
 *
 * Required properties (Phase 1A §11.3): a single shared in-flight auth promise,
 * a rejection cached for the session, no automatic retry after rejection, and
 * no component triggering `GET_USER_ACCOUNT` independently.
 *
 * IMPORTANT: nothing in this module runs at startup. `requestAccount()` is only
 * called from an explicit user action (future owner capability flow), so the
 * visitor shell never opens a permission dialog.
 */

let inFlightAccount: Promise<QortalAccount> | null = null;
let sessionAccount: QortalAccount | null = null;
let sessionFailure: QortalBridgeError | null = null;

function isAccount(value: unknown): value is QortalAccount {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.address === 'string' && typeof candidate.publicKey === 'string';
}

/** Single-flight `GET_USER_ACCOUNT`. Rejections are cached for the session. */
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
      // a user rejection must not be retried automatically.
      if (failure.kind !== 'unavailable') sessionFailure = failure;
      inFlightAccount = null;
      throw failure;
    });

  return inFlightAccount;
}

export function getSessionAccount(): QortalAccount | null {
  return sessionAccount;
}

/** Drop cached account/permission state. Used by tests and future sign-out flows. */
export function resetAuthSession(): void {
  inFlightAccount = null;
  sessionAccount = null;
  sessionFailure = null;
}

/** `GET_PRIMARY_NAME` — the account's preferred publishing name, if any. */
export async function getPrimaryName(address: string): Promise<string | null> {
  const value = await request<unknown>(QortalAction.GET_PRIMARY_NAME, { address });
  if (typeof value === 'string' && value.length > 0) return value;
  if (typeof value === 'object' && value !== null && 'name' in value) {
    const name = (value as { name?: unknown }).name;
    return typeof name === 'string' && name.length > 0 ? name : null;
  }
  return null;
}

/** `GET_ACCOUNT_NAMES` — every name owned by the address (a user may own several). */
export async function getAccountNames(address: string): Promise<string[]> {
  const value = await request<unknown>(QortalAction.GET_ACCOUNT_NAMES, { address });
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

/** `GET_NAME_DATA` — deliberately does not accept a payload `owner` claim. */
export async function getNameData(name: string): Promise<QortalNameData | null> {
  const value = await request<unknown>(QortalAction.GET_NAME_DATA, { name });
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.owner !== 'string') return null;
  return {
    name: typeof candidate.name === 'string' ? candidate.name : name,
    owner: candidate.owner,
  };
}

/**
 * Ownership is proven by comparing the resolved owner address with the
 * connected account address. A name lookup failure yields `null` (unknown),
 * never `true`.
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
