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
