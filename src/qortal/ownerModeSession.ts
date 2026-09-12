/**
 * Tab-scoped marker for an explicit owner-mode session.
 *
 * This stores exactly one fact: "this tab asked for owner mode". It never stores
 * an account address, a permission result or an ownership result, and it is not
 * authority: after a document reload owner capability is re-established only by
 * requesting the current account and re-resolving the *current* owner of the
 * injected `_qdnName`. A transferred name therefore fails closed even while the
 * marker survives.
 *
 * `sessionStorage` is tab-scoped and survives a real document reload (unlike
 * React memory), which is the capability gap this marker closes. Access is
 * guarded because storage can be unavailable or throw in restricted contexts;
 * in that case restoration is simply unavailable and nothing else breaks.
 */

export const OWNER_MODE_STORAGE_KEY = 'shadow-archives:owner-mode';
export const OWNER_MODE_STORAGE_VALUE = 'enabled';

function getSessionStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

/** True only when this tab explicitly opted into owner mode. */
export function isOwnerModeMarked(): boolean {
  const storage = getSessionStorage();
  if (!storage) return false;
  try {
    return storage.getItem(OWNER_MODE_STORAGE_KEY) === OWNER_MODE_STORAGE_VALUE;
  } catch {
    return false;
  }
}

/** Record the explicit owner-mode intent for this tab. */
export function markOwnerMode(): void {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.setItem(OWNER_MODE_STORAGE_KEY, OWNER_MODE_STORAGE_VALUE);
  } catch {
    // Storage unavailable: the in-memory session still works, only reload
    // restoration is lost.
  }
}

/** Drop the marker (sign-out, rejection, confirmed non-owner, failed restore). */
export function clearOwnerModeMarker(): void {
  const storage = getSessionStorage();
  if (!storage) return;
  try {
    storage.removeItem(OWNER_MODE_STORAGE_KEY);
  } catch {
    // Nothing to do: a marker that cannot be removed also cannot be read.
  }
}
