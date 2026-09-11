import type { QdnEnvironment } from '../qortal/types';

/**
 * Publisher scope for canonical Shadow Archives reads.
 *
 * The scope comes from the injected `_qdnName` (the app's own publishing name),
 * never from a payload `author`/`owner`/`publisher` field and never from a
 * hardcoded address. Outside a Qortal host no production QDN identity exists, so
 * the scope is explicitly unresolved rather than assumed.
 */
export type PublisherScope =
  | { readonly scoped: true; readonly name: string }
  | {
      readonly scoped: false;
      readonly reason: 'no-bridge' | 'proxy-context' | 'no-publisher-name';
    };

export function resolvePublisherScope(environment: QdnEnvironment): PublisherScope {
  if (!environment.bridgeAvailable) return { scoped: false, reason: 'no-bridge' };
  if (environment.isProxy) return { scoped: false, reason: 'proxy-context' };
  const name = environment.publisherName;
  if (!name || name.trim().length === 0) return { scoped: false, reason: 'no-publisher-name' };
  return { scoped: true, name };
}

export const UNSCOPED_MESSAGE =
  'No production Qortal publisher identity is available in this context, so QDN content cannot be scoped or verified.';
