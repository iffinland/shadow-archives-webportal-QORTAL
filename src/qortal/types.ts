/**
 * Contract types for the in-repo Qortal integration layer.
 *
 * Scope note (Phase 1B): these types describe the *boundary*. Only the
 * read-only, non-authenticating parts are wired into the visitor shell. Write
 * actions are deliberately not implemented yet.
 */

/** Error taxonomy for bridge calls. `malformed` never becomes a valid domain value. */
export type QortalBridgeErrorKind = 'unavailable' | 'malformed' | 'timeout' | 'rejected' | 'error';

/** Host-mediated permission lifecycle for `GET_USER_ACCOUNT`. */
export type AuthPermissionState = 'idle' | 'pending' | 'granted' | 'rejected' | 'unavailable';

/**
 * Owner-capability states (Phase 1A §11.2). `unknown` is the truthful default
 * outside a Qortal host, in the dev proxy, and whenever an answer cannot be
 * established. The first four are transient lifecycle states that let the UI
 * explain exactly what is happening instead of guessing.
 *
 * `permission-denied` is deliberately distinct from `visitor`: a user who
 * declined the permission dialog is not the same as an unauthenticated visitor.
 * `error` covers a host/bridge failure and must never be reported as `visitor`.
 */
export type CapabilityState =
  | 'unknown'
  | 'requesting-permission'
  | 'resolving-ownership'
  | 'permission-denied'
  | 'error'
  | 'visitor'
  | 'authenticated-no-name'
  | 'authenticated-non-owner'
  | 'owner';

/** QDN environment read from the injected `_qdn*` globals. */
export interface QdnEnvironment {
  /** True when a `qortalRequest` bridge function is present. */
  readonly bridgeAvailable: boolean;
  /** True when Core/`q-apps.js` injected QDN context (i.e. hosted render). */
  readonly isHosted: boolean;
  /** `_qdnContext` as injected, or null. */
  readonly context: string | null;
  /** True when `_qdnContext === 'proxy'` (node dev proxy — no real publisher). */
  readonly isProxy: boolean;
  /** `_qdnService`, expected `APP` for this application. */
  readonly service: string | null;
  /** Raw `_qdnName` (Core percent-encodes spaces, e.g. `Shadow%20Archives`). */
  readonly name: string | null;
  /** Decoded `_qdnName`, suitable for display and for `/names/{name}` lookup re-encoding. */
  readonly publisherName: string | null;
  /** `_qdnIdentifier`, or null. */
  readonly identifier: string | null;
  /** `_qdnPath`, or null. */
  readonly path: string | null;
  /** `_qdnLang`, or null. */
  readonly lang: string | null;
  /** `_qdnBase`; the router basename for an APP resource. */
  readonly base: string;
  /** `_qdnBaseWithPath`, or null. */
  readonly baseWithPath: string | null;
}

/** `GET_USER_ACCOUNT` result (verified shape: address + publicKey only, no name). */
export interface QortalAccount {
  readonly address: string;
  readonly publicKey: string;
}

/**
 * One entry from `GET_ACCOUNT_NAMES`, which Core serves as
 * `GET /names/address/{address}` -> `NameSummary[]` (`{name, owner}`).
 * The owner field is retained so a future acting-name selector can validate a
 * specific name; multiple names are never collapsed into one identity.
 */
export interface QortalNameSummary {
  readonly name: string;
  readonly owner: string;
}

/** Minimal `GET_NAME_DATA` shape needed for ownership checks (`/names/{name}`). */
export interface QortalNameData {
  readonly name: string;
  readonly owner: string;
}

/** Explicit capability input; keeps derivation pure and testable. */
export interface CapabilityInput {
  readonly environment: QdnEnvironment;
  readonly permission: AuthPermissionState;
  readonly account: QortalAccount | null;
  /** True/false when the connected address owns the app publisher name; null when unresolved. */
  readonly ownsPublisherName: boolean | null;
  /** True/false when the account owns at least one registered name; null when unresolved. */
  readonly ownsAnyName: boolean | null;
  /**
   * True once the account's names/ownership resolution finished, whether it
   * succeeded or failed. Keeps `resolving-ownership` transient instead of a
   * permanent lie when a host read fails.
   */
  readonly ownershipResolved: boolean;
}
