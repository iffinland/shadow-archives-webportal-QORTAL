import {
  CATALOG_PARTITION_PREFIX,
  ENTITY_KINDS,
  ENTITY_STATES,
  LIMITS,
  SUPPORTED_SCHEMA_VERSION,
  type EntityKind,
} from './constants';
import { buildEntityIdentifier, isStableId } from './identifiers';
import { validateMediaReference } from './entities';
import type {
  CatalogEntry,
  CatalogListing,
  CatalogManifest,
  CatalogPartitionDescriptor,
} from './types';
import {
  boundedArray,
  fail,
  isOneOf,
  isRecord,
  nonNegativeInteger,
  nonNegativeNumber,
  ok,
  optionalString,
  requireString,
  requireStringAllowEmpty,
  type ValidationResult,
} from './validation';

/** Short token used inside catalog partition identifiers, per kind. */
const PARTITION_TOKEN_BY_KIND: Readonly<Record<EntityKind, string>> = {
  'blog-post': 'post',
  video: 'vid',
  'gallery-item': 'img',
  'gallery-album': 'album',
};

const PARTITION_IDENTIFIER_PATTERN = /^saw_cat_([a-z0-9]+)_p(\d{1,4})$/;
const MANIFEST_TAXONOMY_MAX = 512;

function validatePartitionDescriptor(value: unknown): ValidationResult<CatalogPartitionDescriptor> {
  if (!isRecord(value))
    return fail('invalid-type', 'Catalog partition descriptor must be an object');
  if (!isOneOf(value.type, ENTITY_KINDS)) {
    return fail('invalid-value', `Unknown catalog partition type: ${String(value.type)}`);
  }
  const identifier = requireString(value.identifier, LIMITS.name);
  if (!identifier || !identifier.startsWith(CATALOG_PARTITION_PREFIX)) {
    return fail('invalid-value', 'Catalog partition identifier is invalid');
  }
  const match = PARTITION_IDENTIFIER_PATTERN.exec(identifier);
  if (!match) return fail('invalid-value', 'Catalog partition identifier has the wrong shape');
  const expectedToken = PARTITION_TOKEN_BY_KIND[value.type];
  if (match[1] !== expectedToken) {
    return fail('invalid-value', 'Catalog partition identifier token does not match its type');
  }
  const count = nonNegativeInteger(value.count);
  if (count === null) return fail('invalid-value', 'Catalog partition count is invalid');

  const maxUpdated =
    value.maxUpdated === undefined || value.maxUpdated === null
      ? null
      : nonNegativeInteger(value.maxUpdated);
  if (value.maxUpdated !== undefined && value.maxUpdated !== null && maxUpdated === null) {
    return fail('invalid-value', 'Catalog partition maxUpdated is invalid');
  }

  return ok({
    identifier,
    type: value.type,
    count,
    maxUpdated,
    checksum: optionalString(value.checksum, 160),
  });
}

function readManifestTaxonomy(value: unknown): { categories: string[]; tags: string[] } {
  const result = { categories: [] as string[], tags: [] as string[] };
  if (!isRecord(value)) return result;
  for (const key of ['categories', 'tags'] as const) {
    const raw = boundedArray(value[key], MANIFEST_TAXONOMY_MAX);
    if (!raw) continue;
    for (const entry of raw) {
      if (typeof entry !== 'string') continue;
      const trimmed = entry.trim();
      if (trimmed.length === 0 || trimmed.length > 120) continue;
      result[key].push(trimmed);
    }
  }
  return result;
}

export function validateCatalogManifest(raw: unknown): ValidationResult<CatalogManifest> {
  if (!isRecord(raw)) return fail('not-an-object', 'Catalog manifest is not an object');
  if (raw.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    return fail(
      'unsupported-schema',
      `Unsupported catalog schemaVersion: ${String(raw.schemaVersion)}`,
    );
  }
  if (raw.kind !== 'catalog-manifest') {
    return fail('invalid-value', 'Catalog manifest kind is invalid');
  }
  const catalogVersion = nonNegativeInteger(raw.catalogVersion);
  if (catalogVersion === null || catalogVersion < 1) {
    return fail('invalid-value', 'Catalog manifest catalogVersion is invalid');
  }
  const compiledAt = nonNegativeInteger(raw.compiledAt);
  if (compiledAt === null) {
    return fail('invalid-value', 'Catalog manifest compiledAt is invalid');
  }
  const rawPartitions = boundedArray(raw.partitions, LIMITS.manifestPartitions);
  if (!rawPartitions) {
    return fail('too-large', 'Catalog manifest partitions must be a bounded array');
  }

  const partitions: CatalogPartitionDescriptor[] = [];
  for (const entry of rawPartitions) {
    const descriptor = validatePartitionDescriptor(entry);
    if (!descriptor.ok) return descriptor;
    partitions.push(descriptor.value);
  }

  return ok({
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    kind: 'catalog-manifest',
    catalogVersion,
    compiledAt,
    publisherName: optionalString(raw.publisherName, LIMITS.name),
    partitions,
    taxonomy: readManifestTaxonomy(raw.taxonomy),
  });
}

function readTaxonomyArray(value: unknown): readonly string[] {
  const raw = boundedArray(value, LIMITS.taxonomyArray);
  if (!raw) return [];
  const labels: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (trimmed.length === 0 || trimmed.length > 120) continue;
    labels.push(trimmed);
  }
  return labels;
}

export function validateCatalogEntry(
  raw: unknown,
  type: EntityKind,
): ValidationResult<CatalogEntry> {
  if (!isRecord(raw)) return fail('not-an-object', 'Catalog entry is not an object');
  if (!isStableId(raw.id)) return fail('invalid-value', 'Catalog entry id must be a stable id');

  const service = requireString(raw.service, 32);
  if (service !== 'DOCUMENT') {
    return fail('invalid-value', 'Catalog entry service must be DOCUMENT');
  }
  const identifier = requireString(raw.identifier, 64);
  if (identifier !== buildEntityIdentifier(type, raw.id)) {
    return fail('invalid-value', 'Catalog entry identifier does not match its type and id');
  }

  const title = requireString(raw.title, LIMITS.title);
  if (!title) return fail('invalid-value', 'Catalog entry title is required');

  const slug = requireStringAllowEmpty(raw.slug, LIMITS.slug);
  if (slug === null) return fail('invalid-value', 'Catalog entry slug is invalid');
  if (slug.length > 0 && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return fail('invalid-value', 'Catalog entry slug is invalid');
  }

  const excerpt = requireStringAllowEmpty(raw.excerpt, LIMITS.excerpt);
  if (excerpt === null) return fail('invalid-value', 'Catalog entry excerpt is invalid');

  const createdAt = nonNegativeInteger(raw.createdAt);
  const updatedAt = nonNegativeInteger(raw.updatedAt);
  if (createdAt === null || updatedAt === null) {
    return fail('invalid-value', 'Catalog entry timestamps are invalid');
  }
  if (!isOneOf(raw.state, ENTITY_STATES)) {
    return fail('invalid-value', 'Catalog entry state is invalid');
  }

  const durationSeconds =
    raw.durationSeconds === undefined || raw.durationSeconds === null
      ? null
      : nonNegativeNumber(raw.durationSeconds);
  const width =
    raw.width === undefined || raw.width === null ? null : nonNegativeInteger(raw.width);
  const height =
    raw.height === undefined || raw.height === null ? null : nonNegativeInteger(raw.height);
  const albumId = optionalString(raw.albumId, 12);
  if (albumId !== null && !isStableId(albumId)) {
    return fail('invalid-value', 'Catalog entry albumId must be a stable id');
  }

  return ok({
    id: raw.id,
    service,
    identifier,
    title,
    slug,
    excerpt,
    createdAt,
    updatedAt,
    categories: readTaxonomyArray(raw.categories),
    tags: readTaxonomyArray(raw.tags),
    thumbnail:
      raw.thumbnail === undefined || raw.thumbnail === null
        ? null
        : validateMediaReference(raw.thumbnail),
    state: raw.state,
    contentHash: optionalString(raw.contentHash, 160),
    likeCount:
      raw.likeCount === undefined || raw.likeCount === null
        ? null
        : nonNegativeInteger(raw.likeCount),
    commentCount:
      raw.commentCount === undefined || raw.commentCount === null
        ? null
        : nonNegativeInteger(raw.commentCount),
    countsCompiledAt:
      raw.countsCompiledAt === undefined || raw.countsCompiledAt === null
        ? null
        : nonNegativeInteger(raw.countsCompiledAt),
    durationSeconds,
    width,
    height,
    albumId,
  });
}

export interface ValidatedCatalogPartition {
  readonly schemaVersion: number;
  readonly kind: 'catalog-partition';
  readonly type: EntityKind;
  readonly partition: number;
  readonly compiledAt: number;
  readonly listings: readonly CatalogListing[];
  /** Entries that failed validation; the rest of the partition still loads. */
  readonly rejectedEntries: number;
}

export function validateCatalogPartition(
  raw: unknown,
  expectedType?: EntityKind,
  expectedIdentifier?: string,
): ValidationResult<ValidatedCatalogPartition> {
  if (!isRecord(raw)) return fail('not-an-object', 'Catalog partition is not an object');
  if (raw.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    return fail(
      'unsupported-schema',
      `Unsupported catalog schemaVersion: ${String(raw.schemaVersion)}`,
    );
  }
  if (raw.kind !== 'catalog-partition') {
    return fail('invalid-value', 'Catalog partition kind is invalid');
  }
  if (!isOneOf(raw.type, ENTITY_KINDS)) {
    return fail('invalid-value', 'Catalog partition type is invalid');
  }
  if (expectedType && raw.type !== expectedType) {
    return fail('invalid-value', 'Catalog partition type does not match its manifest descriptor');
  }
  const partition = nonNegativeInteger(raw.partition);
  if (partition === null) return fail('invalid-value', 'Catalog partition index is invalid');
  const compiledAt = nonNegativeInteger(raw.compiledAt);
  if (compiledAt === null) return fail('invalid-value', 'Catalog partition compiledAt is invalid');

  const entries = boundedArray(raw.entries, LIMITS.partitionEntries);
  if (!entries) {
    return fail('too-large', 'Catalog partition entries must be a bounded array');
  }

  const type = raw.type;
  const listings: CatalogListing[] = [];
  let rejectedEntries = 0;
  for (const entry of entries) {
    const validated = validateCatalogEntry(entry, type);
    if (!validated.ok) {
      rejectedEntries += 1;
      continue;
    }
    listings.push({
      ...validated.value,
      type,
      partitionIdentifier: expectedIdentifier ?? '',
    });
  }

  return ok({
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    kind: 'catalog-partition',
    type,
    partition,
    compiledAt,
    listings,
    rejectedEntries,
  });
}
