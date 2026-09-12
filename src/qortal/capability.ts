import type { CapabilityInput, CapabilityState, QdnEnvironment } from './types';

/**
 * True only for the fully capable runtime state: a Qortal-served frame that has
 * a reachable host bridge and a real deployed resource identity.
 *
 * This is the single gate for owner/write capability. Read-only scope is
 * deliberately NOT gated on it (see `resolvePublisherScope`): a published
 * `qortal-render-readonly` frame can browse, but it can never own or write.
 */
export function isOwnerCapableRuntime(environment: QdnEnvironment): boolean {
  return environment.runtimeState === 'qortal-host';
}

/**
 * Pure derivation of the owner-capability state from environment + resolved
 * permission/identity (Phase 1A §11.2).
 *
 * Rules, in order:
 * 1. Only a `qortal-host` runtime (bridge + injected `_qdn*` identity, not the
 *    dev proxy) can establish owner capability. A published read-only render
 *    context, a plain browser and the dev proxy all resolve to `unknown`
 *    (never owner), because none of them can prove authorisation.
 * 2. The auth lifecycle maps to truthful transient states.
 * 3. Owner is reported only when the connected account's address provably
 *    equals the *current* owner of the decoded `_qdnName`.
 *
 * Payload `author`/`owner` fields never participate here, and a name-transfer
 * is naturally handled because ownership is re-resolved on every explicit
 * capability run.
 */
export function deriveCapability(input: CapabilityInput): CapabilityState {
  const { environment, permission, account, ownsPublisherName, ownsAnyName, ownershipResolved } =
    input;

  if (!isOwnerCapableRuntime(environment)) return 'unknown';

  switch (permission) {
    case 'idle':
      return 'unknown';
    case 'pending':
      return 'requesting-permission';
    case 'rejected':
      return 'permission-denied';
    case 'unavailable':
      return 'error';
    case 'granted':
      break;
  }

  if (!account) return 'visitor';

  // A positive owner proof is the strongest signal and short-circuits.
  if (ownsPublisherName === true) return 'owner';

  // No registered name at all is distinct from "authenticated but not the
  // owner": an account with zero names cannot publish under any name.
  if (ownsAnyName === false) return 'authenticated-no-name';

  if (ownsPublisherName === false) return 'authenticated-non-owner';

  // Ownership/name resolution has not finished yet, or failed without proof.
  if (!ownershipResolved) return 'resolving-ownership';

  // Resolution finished but no positive answer (for example `_qdnName` missing
  // or a malformed name lookup). Fail closed: unknown, never owner.
  return 'unknown';
}

/** True only for a positively established owner. Never optimistic. */
export function isOwner(capability: CapabilityState): boolean {
  return capability === 'owner';
}
