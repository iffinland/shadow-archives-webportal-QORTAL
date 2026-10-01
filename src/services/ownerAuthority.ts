/**
 * Shared owner-write authority gate.
 *
 * Every Shadow Archives write (Gallery, Video) must pass the same two checks:
 * a fully capable runtime check before any work starts, and a *fresh* ownership
 * proof immediately before each write so a name transfer between the capability
 * check and the write blocks the write.
 *
 * This is security-relevant logic and exists once. Each feature maps the
 * returned failure onto its own error type so the owner-facing taxonomy
 * (`not-hosted` / `not-owner` / `authority-unresolved` / `authority-changed`)
 * stays identical across features.
 *
 * Not re-exported from `services/index.ts`: it is only reachable from the lazy
 * owner boundaries.
 */

import { isOwnerCapableRuntime } from '../qortal/capability';
import { getNameData } from '../qortal/auth';
import type { CapabilityState, QdnEnvironment, QortalAccount } from '../qortal/types';

/** Owner/authority context supplied by the React layer from the real providers. */
export interface OwnerWriteContext {
  readonly capability: CapabilityState;
  readonly account: QortalAccount | null;
  readonly environment: QdnEnvironment;
}

export type OwnerAuthorityCode =
  'not-hosted' | 'not-owner' | 'authority-unresolved' | 'authority-changed';

export interface OwnerAuthorityFailure {
  readonly code: OwnerAuthorityCode;
  readonly message: string;
}

/**
 * Local, synchronous authority check.
 *
 * Writes are gated on the fully capable runtime state only (`qortal-host`:
 * injected identity + reachable bridge, never the dev proxy). The read-only
 * same-origin fallback is deliberately NOT sufficient for a write.
 *
 * `subject` is the feature label used in the owner-facing message.
 */
export function authorityFailure(
  ctx: OwnerWriteContext,
  publisherName: string | null,
  subject: string,
): OwnerAuthorityFailure | null {
  if (!isOwnerCapableRuntime(ctx.environment)) {
    return {
      code: 'not-hosted',
      message: `${subject} publishing requires the app to run inside a real Qortal host with an account bridge.`,
    };
  }
  if (ctx.capability !== 'owner') {
    return {
      code: 'not-owner',
      message: `${subject} publishing requires a positively verified owner capability.`,
    };
  }
  if (!ctx.account) {
    return { code: 'authority-unresolved', message: 'No connected Qortal account is available.' };
  }
  if (!publisherName || ctx.environment.publisherName !== publisherName) {
    return {
      code: 'authority-unresolved',
      message: 'The publishing name could not be derived from the app identity.',
    };
  }
  return null;
}

/**
 * Fresh ownership proof, run immediately before every write.
 *
 * A failed ownership read is `authority-unresolved` (we could not prove
 * anything) while a successful read naming a different owner is
 * `authority-changed`; the two must never be conflated.
 */
export async function authorityFreshFailure(
  ctx: OwnerWriteContext,
  publisherName: string,
  subject: string,
): Promise<OwnerAuthorityFailure | null> {
  const local = authorityFailure(ctx, publisherName, subject);
  if (local) return local;

  const account = ctx.account;
  if (!account) {
    return { code: 'authority-unresolved', message: 'No connected Qortal account is available.' };
  }

  let owner: string | null;
  try {
    const data = await getNameData(publisherName);
    owner = data?.owner ?? null;
  } catch {
    owner = null;
  }
  if (!owner) {
    return {
      code: 'authority-unresolved',
      message: 'Current ownership of the publishing name could not be re-established.',
    };
  }
  if (owner !== account.address) {
    return {
      code: 'authority-changed',
      message:
        'The connected account no longer owns the publishing name, so nothing was published.',
    };
  }
  return null;
}
