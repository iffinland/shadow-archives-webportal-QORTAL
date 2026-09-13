import {
  CATALOG_MANIFEST_IDENTIFIER,
  CATALOG_PARTITION_PREFIX,
  ENTITY_IDENTIFIER_PATTERN,
  IDENTIFIER_KIND_BY_PREFIX,
  IDENTIFIER_NAMESPACE,
  IDENTIFIER_PREFIX_BY_KIND,
  STABLE_ID_PATTERN,
  type EntityKind,
} from './constants';

export function isStableId(value: unknown): value is string {
  return typeof value === 'string' && STABLE_ID_PATTERN.test(value);
}

/** `saw_post_<id12>` etc. */
export function buildEntityIdentifier(kind: EntityKind, id: string): string {
  return `${IDENTIFIER_PREFIX_BY_KIND[kind]}${id}`;
}

export interface ParsedEntityIdentifier {
  readonly kind: EntityKind;
  readonly id: string;
}

/**
 * Parse an entity identifier strictly: the whole string must be a namespace
 * prefix plus a 12-char stable id. Anything else (including a longer identifier
 * that merely starts with a prefix, or a substring match) is rejected so
 * prefix/substring collisions cannot be mistaken for exact identity.
 */
export function parseEntityIdentifier(identifier: unknown): ParsedEntityIdentifier | null {
  if (typeof identifier !== 'string' || !ENTITY_IDENTIFIER_PATTERN.test(identifier)) return null;
  if (!identifier.startsWith(IDENTIFIER_NAMESPACE)) return null;

  for (const [prefix, kind] of Object.entries(IDENTIFIER_KIND_BY_PREFIX)) {
    if (!identifier.startsWith(prefix)) continue;
    const id = identifier.slice(prefix.length);
    return isStableId(id) ? { kind, id } : null;
  }
  return null;
}

/**
 * Resolve a route reference to a bare stable id.
 *
 * The canonical detail URL uses the bare 12-character stable id, but the full
 * entity identifier (`saw_post_<id12>`) is accepted as a cheap alias. A full
 * identifier for a different kind is rejected (returns null).
 */
export function resolveEntityReference(kind: EntityKind, reference: unknown): string | null {
  if (isStableId(reference)) return reference;
  const parsed = parseEntityIdentifier(reference);
  if (parsed && parsed.kind === kind) return parsed.id;
  return null;
}

/** True when the identifier is a catalog resource identifier (manifest/partition). */
export function isCatalogIdentifier(identifier: unknown): boolean {
  return (
    typeof identifier === 'string' &&
    (identifier === CATALOG_MANIFEST_IDENTIFIER || identifier.startsWith(CATALOG_PARTITION_PREFIX))
  );
}

/** Prefix used for fallback discovery of one entity kind. */
export function discoveryPrefix(kind: EntityKind): string {
  return IDENTIFIER_PREFIX_BY_KIND[kind];
}

const BASE36_ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
/**
 * Largest multiple of 36 that fits in a byte; values at or above it are
 * rejected so `% 36` stays uniform (modulo bias would shrink the effective
 * entropy of the stable id).
 */
const BASE36_REJECTION_THRESHOLD = 252;

/** Injectable entropy source so the generator stays testable and deterministic in tests. */
export type RandomBytes = (length: number) => Uint8Array;

function cryptoRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  const source = globalThis.crypto;
  if (!source || typeof source.getRandomValues !== 'function') {
    throw new Error('Cryptographically secure randomness is unavailable in this context');
  }
  // `getRandomValues` rejects requests above 65536 bytes; the stable id needs 12.
  source.getRandomValues(bytes);
  return bytes;
}

/**
 * Generate the contract's stable id: exactly 12 lowercase base36 characters
 * (~62 bits) from cryptographically strong browser randomness.
 *
 * `Date.now`, `Math.random` and title slugs are deliberately NOT used: the id is
 * an identity, not a display value, and collisions are resolved by the caller's
 * bounded retry rather than by a timestamp.
 */
export function generateStableId(random: RandomBytes = cryptoRandomBytes): string {
  let value = '';
  while (value.length < 12) {
    const bytes = random(12);
    for (const byte of bytes) {
      if (value.length === 12) break;
      if (byte >= BASE36_REJECTION_THRESHOLD) continue;
      value += BASE36_ALPHABET[byte % 36];
    }
  }
  return value;
}

export interface GenerateUniqueStableIdOptions {
  /** Bounded retry budget; the contract requires a bounded collision check. */
  readonly maxAttempts?: number;
  readonly random?: RandomBytes;
}

/**
 * Generate a stable id that is not already taken. `isTaken` is supplied by the
 * caller (catalog entries and/or an exact resource lookup). Exhausting the
 * bounded budget throws instead of looping forever.
 */
export async function generateUniqueStableId(
  isTaken: (id: string) => boolean | Promise<boolean>,
  options: GenerateUniqueStableIdOptions = {},
): Promise<string> {
  const maxAttempts = options.maxAttempts ?? 8;
  const random = options.random ?? cryptoRandomBytes;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const id = generateStableId(random);
    if (!(await isTaken(id))) return id;
  }
  throw new Error('Could not generate a unique gallery id after repeated attempts');
}

/** Media identifier family for a gallery item id (`saw_img_media_<id12>`). */
export function buildGalleryMediaIdentifier(id: string): string {
  return `saw_img_media_${id}`;
}

/** Thumbnail identifier family for a gallery item id (`saw_img_thumb_<id12>`). */
export function buildGalleryThumbnailIdentifier(id: string): string {
  return `saw_img_thumb_${id}`;
}

/** Recover the item id from a related media/thumbnail identifier, when it matches the shape. */
export function parseGalleryMediaIdentifier(
  identifier: unknown,
): { readonly kind: 'media' | 'thumbnail'; readonly id: string } | null {
  if (typeof identifier !== 'string') return null;
  for (const [prefix, kind] of [
    ['saw_img_media_', 'media'],
    ['saw_img_thumb_', 'thumbnail'],
  ] as const) {
    if (!identifier.startsWith(prefix)) continue;
    const id = identifier.slice(prefix.length);
    return isStableId(id) ? { kind, id } : null;
  }
  return null;
}

/** Poster identifier family for a video id (`saw_vid_thumb_<id12>`). */
export function buildVideoThumbnailIdentifier(id: string): string {
  return `saw_vid_thumb_${id}`;
}

/**
 * Recover the video id from a poster identifier, when it matches the shape.
 *
 * The interoperable `VIDEO` media resource of a Shadow Archives publication is
 * NOT in this family: it lives at the Q-Tube video base identifier for the same
 * id (see `services/qtubeVideoContract.ts`) so the ecosystem convention that the
 * media identifier equals the metadata identifier minus `_metadata` holds.
 */
export function parseVideoThumbnailIdentifier(
  identifier: unknown,
): { readonly kind: 'thumbnail'; readonly id: string } | null {
  if (typeof identifier !== 'string') return null;
  const prefix = 'saw_vid_thumb_';
  if (!identifier.startsWith(prefix)) return null;
  const id = identifier.slice(prefix.length);
  return isStableId(id) ? { kind: 'thumbnail', id } : null;
}

/** Thumbnail/cover identifier family for a blog post id (`saw_post_thumb_<id12>`). */
export function buildBlogThumbnailIdentifier(id: string): string {
  return `saw_post_thumb_${id}`;
}

/** Recover the blog post id from a cover identifier, when it matches the shape. */
export function parseBlogThumbnailIdentifier(
  identifier: unknown,
): { readonly kind: 'thumbnail'; readonly id: string } | null {
  if (typeof identifier !== 'string') return null;
  const prefix = 'saw_post_thumb_';
  if (!identifier.startsWith(prefix)) return null;
  const id = identifier.slice(prefix.length);
  return isStableId(id) ? { kind: 'thumbnail', id } : null;
}
