import type { CapabilityInput, CapabilityState } from './types';

/**
 * Pure derivation of the owner-capability state from environment + resolved
 * permission/identity (Phase 1A §11.2).
 *
 * Rules, in order:
 * 1. No bridge, or the node dev-proxy context, cannot establish a real
 *    deployed publishing identity -> `unknown` (never owner).
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

  if (!environment.bridgeAvailable || environment.isProxy) return 'unknown';

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
