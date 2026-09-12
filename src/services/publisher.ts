import type { QdnEnvironment } from '../qortal/types';

/**
 * Publisher scope for canonical Shadow Archives reads.
 *
 * The scope comes from the injected `_qdnName` (the app's own publishing name),
 * never from a payload `author`/`owner`/`publisher` field and never from a
 * hardcoded address.
 *
 * IMPORTANT (2026-09-12 runtime fix): the scope deliberately does NOT require the
 * host account bridge. A published `render` context injects a real, authoritative
 * publishing identity (`_qdnService` + `_qdnName`) and is fully sufficient to
 * scope and verify *read-only* QDN content. Requiring the bridge here collapsed
 * "published read-only runtime" into "no publisher identity", which is false.
 */
export type UnscopedReason = 'no-qortal-context' | 'proxy-context' | 'no-publisher-name';

export type PublisherScope =
  | { readonly scoped: true; readonly name: string; readonly service: string | null }
  | { readonly scoped: false; readonly reason: UnscopedReason };

export function resolvePublisherScope(environment: QdnEnvironment): PublisherScope {
  // The node dev proxy injects `_qdn*` values but carries no deployed resource
  // identity (`_qdnName` is empty), so it can never be a real publisher scope.
  if (environment.isProxy) return { scoped: false, reason: 'proxy-context' };

  const name = environment.publisherName?.trim();
  if (!name) {
    return {
      scoped: false,
      reason:
        environment.runtimeState === 'plain-browser' ? 'no-qortal-context' : 'no-publisher-name',
    };
  }
  return { scoped: true, name, service: environment.service };
}

/**
 * Truthful per-reason copy. There is no single "no publisher identity" message:
 * a plain browser and a Qortal-served frame without a name are different states.
 */
export const UNSCOPED_MESSAGES: Record<UnscopedReason, string> = {
  'no-qortal-context':
    'This page is not running inside a Qortal runtime, so there is no published Shadow Archives identity to scope or verify QDN content with. Open the published app to browse the archive.',
  'proxy-context':
    'The Qortal node development proxy does not carry the deployed publishing identity, so QDN content cannot be scoped or verified in this context.',
  'no-publisher-name':
    'This frame was served by Qortal but no publishing name was injected, so QDN content cannot be scoped or verified.',
};

export function unscopedMessage(reason: UnscopedReason): string {
  return UNSCOPED_MESSAGES[reason];
}
