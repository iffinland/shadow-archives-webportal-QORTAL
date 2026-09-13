/**
 * Q-App identifier math (shared, adapter support).
 *
 * Several current Qortal apps built on `qapp-core` derive their QDN identifiers
 * from a per-app name, a per-app public salt and an entity/parent pair, using
 * `qapp-core`'s `hashWord` + `buildIdentifier` / `buildSearchPrefix`
 * (`Qortal/qapp-core` `master` @ 0f9d6ac, `src/utils/encryption.ts`). To publish
 * into (or discover from) another app's namespace without importing or vendoring
 * that app, Shadow Archives mirrors that exact math here — once.
 *
 * The mirror is byte-exact:
 *   saltedWord = publicSalt + word                 (UTF-8)
 *   digest     = SHA-256(saltedWord)               (bytes)
 *   base64     = standard base64 of the digest
 *   safeBase64 = base64 with '+'→'.', '/'→'~', '_'→'!' and '='/padding removed
 *   hash       = safeBase64.slice(0, collisionStrength)
 *
 * `collisionStrength` values come from `EnumCollisionStrength`: app name and
 * parent references use 14 characters, entity labels 6. `IDENTIFIER_BUILDER_VERSION`
 * in current `qapp-core` is the literal `v1`, which every built identifier ends
 * with.
 *
 * This module is pure and has no Qortal bridge access, so it is safe to unit
 * test and to import from either adapter (SubWire, Quitter) or a verification
 * path. It is deliberately not re-exported from `services/index.ts`.
 */

/** `EnumCollisionStrength` (qapp-core `src/utils/encryption.ts`). */
export const QAPP_COLLISION = {
  HIGH: 14,
  ENTITY_LABEL: 6,
  PARENT_REF: 14,
} as const;

/** `IDENTIFIER_BUILDER_VERSION` in current `qapp-core`. */
export const QAPP_IDENTIFIER_VERSION = 'v1';

function safeBase64(base64: string): string {
  return base64.replace(/\+/g, '.').replace(/\//g, '~').replace(/_/g, '!').replace(/=+$/, '');
}

/**
 * Sans-io `hashWord`. Requires SubtleCrypto (every supported browser and the
 * Node runtime used by the build/test toolchain provide it); silently hashing
 * with a different algorithm would produce identifiers the other app cannot
 * discover, so an unavailable digest fails loudly instead.
 */
export async function qappHashWord(
  word: string,
  collisionStrength: number,
  publicSalt: string,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('SHA-256 is unavailable, so a cross-app identifier cannot be derived');
  }
  const bytes = new TextEncoder().encode(`${publicSalt}${word}`);
  const digest = await subtle.digest('SHA-256', bytes);
  const base64 = btoa(Array.from(new Uint8Array(digest), (b) => String.fromCharCode(b)).join(''));
  return safeBase64(base64).slice(0, collisionStrength);
}

async function appHash(appName: string, publicSalt: string): Promise<string> {
  return qappHashWord(appName, QAPP_COLLISION.HIGH, publicSalt);
}

async function entityHash(entityType: string, publicSalt: string): Promise<string> {
  return qappHashWord(entityType, QAPP_COLLISION.ENTITY_LABEL, publicSalt);
}

async function parentRefHash(parentId: string, publicSalt: string): Promise<string> {
  return qappHashWord(parentId, QAPP_COLLISION.PARENT_REF, publicSalt);
}

/**
 * Mirrors `buildIdentifier(appName, publicSalt, entityType, parentId, false)`.
 *
 * `uid` replaces `qapp-core`'s random 15-character unique id. Shadow Archives
 * supplies a deterministic token (its own 12-character stable id) so the derived
 * cross-app coordinate is recoverable from the canonical Shadow Archives id and
 * a retry cannot mint a duplicate.
 */
export async function buildQappIdentifier(params: {
  readonly appName: string;
  readonly publicSalt: string;
  readonly entityType: string;
  readonly parentId: string | null;
  readonly uid: string;
}): Promise<string> {
  const app = await appHash(params.appName, params.publicSalt);
  const entity = await entityHash(params.entityType, params.publicSalt);
  const parent =
    params.parentId === null
      ? '00000000000000'
      : await parentRefHash(params.parentId, params.publicSalt);
  return `${app}-${entity}-${parent}-${params.uid}-${QAPP_IDENTIFIER_VERSION}`;
}

/**
 * Mirrors `buildSearchPrefix(appName, publicSalt, entityType, parentId)`.
 *
 * This is the string the other app passes as `identifier` with `prefix: true`
 * to `SEARCH_QDN_RESOURCES`, so matching it is what makes a publication
 * discoverable by that app.
 */
export async function buildQappSearchPrefix(params: {
  readonly appName: string;
  readonly publicSalt: string;
  readonly entityType: string;
  readonly parentId: string | null;
}): Promise<string> {
  const app = await appHash(params.appName, params.publicSalt);
  const entity = await entityHash(params.entityType, params.publicSalt);
  const parent =
    params.parentId === null
      ? '00000000000000'
      : await parentRefHash(params.parentId, params.publicSalt);
  return `${app}-${entity}-${parent}-`;
}

/**
 * Recover the deterministic token of an identifier built by
 * `buildQappIdentifier`, when (and only when) it matches the expected prefix.
 */
export function parseQappIdentifier(
  identifier: unknown,
  prefix: string,
  expectedLength: number,
): string | null {
  if (typeof identifier !== 'string') return null;
  if (!identifier.startsWith(prefix)) return null;
  if (!identifier.endsWith(`-${QAPP_IDENTIFIER_VERSION}`)) return null;
  const token = identifier.slice(
    prefix.length,
    identifier.length - QAPP_IDENTIFIER_VERSION.length - 1,
  );
  if (token.length !== expectedLength) return null;
  return token;
}

/** Memoized prefix/hash pair so a render or a retry never re-hashes needlessly. */
export function memoizeAsync<T>(factory: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => {
    if (!cached) cached = factory();
    return cached;
  };
}
