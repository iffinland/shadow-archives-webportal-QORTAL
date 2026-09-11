import type { CapabilityInput, CapabilityState } from './types';

/**
 * Pure derivation of the owner-capability state from environment + resolved
 * permission/identity (Phase 1A §11.2).
 *
 * - `unknown` is returned whenever the answer is genuinely unknown: no bridge,
 *   dev-proxy context, unresolved auth, or unresolved ownership. Owner UI must
 *   stay hidden rather than assume anything.
 * - Payload `author`/`owner` fields never participate here.
 */
export function deriveCapability(input: CapabilityInput): CapabilityState {
  const { environment, permission, account, ownsPublisherName, ownsAnyName } = input;

  if (!environment.bridgeAvailable || environment.isProxy) return 'unknown';
  if (permission === 'unavailable' || permission === 'idle' || permission === 'pending') {
    return 'unknown';
  }
  if (permission === 'rejected') return 'visitor';
  if (!account) return 'visitor';

  if (ownsPublisherName === true) return 'owner';
  if (ownsPublisherName === false) return 'authenticated-non-owner';
  if (ownsAnyName === false) return 'authenticated-no-name';
  return 'unknown';
}

/** True only for a positively established owner. Never optimistic. */
export function isOwner(capability: CapabilityState): boolean {
  return capability === 'owner';
}
