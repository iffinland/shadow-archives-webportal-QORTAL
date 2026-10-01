/**
 * Catalog write support (Phase 3A).
 *
 * The catalog stays derived and non-authoritative: the entity resource is
 * written first and the partition + manifest are republished afterwards. This
 * module builds those payloads from the existing validated types and the exact
 * read-pipeline format (`domain/catalog.ts`), so a newly published entry is
 * consumable by the unchanged read path.
 *
 * It is deliberately pure (no bridge, no cache): the service layer owns ordering,
 * authority checks and error handling. It is also not re-exported from
 * `services/index.ts`, so it stays out of the visitor startup graph.
 */

import {
  CATALOG_MANIFEST_IDENTIFIER,
  LIMITS,
  SUPPORTED_SCHEMA_VERSION,
  type EntityKind,
} from '../domain/constants';
import { validateCatalogManifest, validateCatalogPartition } from '../domain/catalog';
import { buildEntityIdentifier, isStableId } from '../domain/identifiers';
import { normalizeTaxonomySlug } from '../domain/taxonomy';
import type {
  BlogPost,
  CatalogEntry,
  CatalogListing,
  CatalogManifest,
  GalleryAlbum,
  GalleryItem,
  VideoEntry,
} from '../domain/types';

/** Partition token per kind, matching the read pipeline's `PARTITION_TOKEN_BY_KIND`. */
const PARTITION_TOKEN_BY_KIND: Readonly<Record<EntityKind, string>> = {
  'blog-post': 'post',
  video: 'vid',
  'gallery-item': 'img',
  'gallery-album': 'album',
};

/** Self-imposed partition capacity (contract §7.3: ~200 entries, <= ~256 KB). */
export const CATALOG_PARTITION_CAPACITY = 200;
export const CATALOG_PARTITION_BYTE_BUDGET = 256 * 1024;

/** Manifest taxonomy list cap (mirrors `catalog.ts` `MANIFEST_TAXONOMY_MAX`). */
const MANIFEST_TAXONOMY_MAX = 512;

export interface CatalogPartitionPayload {
  readonly schemaVersion: number;
  readonly kind: 'catalog-partition';
  readonly type: EntityKind;
  readonly partition: number;
  readonly compiledAt: number;
  readonly entries: readonly unknown[];
}

export interface CatalogManifestPayload {
  readonly schemaVersion: number;
  readonly kind: 'catalog-manifest';
  readonly catalogVersion: number;
  readonly compiledAt: number;
  readonly publisherName: string | null;
  readonly partitions: readonly {
    readonly identifier: string;
    readonly type: EntityKind;
    readonly count: number;
    readonly maxUpdated: number | null;
    readonly checksum: string | null;
  }[];
  readonly taxonomy: { readonly categories: readonly string[]; readonly tags: readonly string[] };
}

export interface CatalogWritePlan {
  readonly partitionIdentifier: string;
  readonly partition: CatalogPartitionPayload;
  readonly manifest: CatalogManifestPayload;
  readonly manifestIdentifier: string;
  readonly createdCatalog: boolean;
  readonly catalogVersion: number;
}

/** Deterministic checksum; the default uses SubtleCrypto when available. */
export type CatalogChecksumFn = (value: unknown) => Promise<string | null>;

async function defaultChecksum(value: unknown): Promise<string | null> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return null;
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const digest = await subtle.digest('SHA-256', bytes);
    const hex = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    return `sha256:${hex}`;
  } catch {
    return null;
  }
}

function slugFromTitle(title: string): string {
  return normalizeTaxonomySlug(title) ?? '';
}

function boundedLabels(labels: readonly string[]): string[] {
  return labels.slice(0, LIMITS.taxonomyArray);
}

/** Catalog representation of a gallery item (contract §5.3 / §7.2). */
export function catalogEntryFromGalleryItem(
  item: GalleryItem,
  contentHash: string | null,
): CatalogEntry {
  return {
    id: item.id,
    service: 'DOCUMENT',
    identifier: buildEntityIdentifier('gallery-item', item.id),
    title: item.data.title,
    slug: slugFromTitle(item.data.title),
    excerpt: item.data.description.slice(0, LIMITS.excerpt),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    categories: boundedLabels(item.data.categories),
    tags: boundedLabels(item.data.tags),
    thumbnail: item.data.thumbnail,
    state: item.state,
    contentHash,
    likeCount: null,
    commentCount: null,
    countsCompiledAt: null,
    durationSeconds: null,
    width: item.data.width,
    height: item.data.height,
    albumId: item.data.albumId,
  };
}

/** Catalog representation of a video entity (contract §5.2 / §7.2). */
export function catalogEntryFromVideoEntry(
  video: VideoEntry,
  contentHash: string | null,
): CatalogEntry {
  return {
    id: video.id,
    service: 'DOCUMENT',
    identifier: buildEntityIdentifier('video', video.id),
    title: video.data.title,
    slug: video.data.slug,
    excerpt: video.data.description.slice(0, LIMITS.excerpt),
    createdAt: video.createdAt,
    updatedAt: video.updatedAt,
    categories: boundedLabels(video.data.categories),
    tags: boundedLabels(video.data.tags),
    thumbnail: video.data.thumbnail,
    state: video.state,
    contentHash,
    likeCount: null,
    commentCount: null,
    countsCompiledAt: null,
    durationSeconds: video.data.durationSeconds,
    width: null,
    height: null,
    albumId: null,
  };
}

/** Catalog representation of a blog post (contract §5.1 / §7.2). */
export function catalogEntryFromBlogPost(post: BlogPost, contentHash: string | null): CatalogEntry {
  return {
    id: post.id,
    service: 'DOCUMENT',
    identifier: buildEntityIdentifier('blog-post', post.id),
    title: post.data.title,
    slug: post.data.slug,
    excerpt: post.data.excerpt.slice(0, LIMITS.excerpt),
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
    categories: boundedLabels(post.data.categories),
    tags: boundedLabels(post.data.tags),
    thumbnail: post.data.thumbnail,
    state: post.state,
    contentHash,
    likeCount: null,
    commentCount: null,
    countsCompiledAt: null,
    durationSeconds: null,
    width: null,
    height: null,
    albumId: null,
  };
}

/** Catalog representation of a gallery album (contract §5.4 / §7.2). */
export function catalogEntryFromGalleryAlbum(
  album: GalleryAlbum,
  contentHash: string | null,
): CatalogEntry {
  return {
    id: album.id,
    service: 'DOCUMENT',
    identifier: buildEntityIdentifier('gallery-album', album.id),
    title: album.data.title,
    slug: slugFromTitle(album.data.title),
    excerpt: album.data.description.slice(0, LIMITS.excerpt),
    createdAt: album.createdAt,
    updatedAt: album.updatedAt,
    categories: boundedLabels(album.data.categories),
    tags: boundedLabels(album.data.tags),
    thumbnail: album.data.coverThumbnail,
    state: album.state,
    contentHash,
    likeCount: null,
    commentCount: null,
    countsCompiledAt: null,
    durationSeconds: null,
    width: null,
    height: null,
    albumId: null,
  };
}

interface ExistingCatalog {
  readonly manifest: CatalogManifest | null;
  readonly listings: readonly CatalogListing[];
}

function partitionNumber(identifier: string, token: string): number | null {
  const match = new RegExp(`^saw_cat_${token}_p(\\d{1,4})$`).exec(identifier);
  if (!match) return null;
  const value = Number.parseInt(match[1], 10);
  return Number.isInteger(value) ? value : null;
}

function listingToEntry(listing: CatalogListing): CatalogEntry {
  return {
    id: listing.id,
    service: listing.service,
    identifier: listing.identifier,
    title: listing.title,
    slug: listing.slug,
    excerpt: listing.excerpt,
    createdAt: listing.createdAt,
    updatedAt: listing.updatedAt,
    categories: listing.categories,
    tags: listing.tags,
    thumbnail: listing.thumbnail,
    state: listing.state,
    contentHash: listing.contentHash,
    likeCount: listing.likeCount,
    commentCount: listing.commentCount,
    countsCompiledAt: listing.countsCompiledAt,
    durationSeconds: listing.durationSeconds,
    width: listing.width,
    height: listing.height,
    albumId: listing.albumId,
  };
}

/**
 * A catalog entry the read validator will accept. Rebuilt entries come from
 * already-validated entities, but the planner must never let one malformed
 * candidate make `assertCatalogPlanValid` reject an otherwise good rebuild.
 */
function isPlannableEntry(entry: CatalogEntry): boolean {
  return (
    entry.title.trim().length > 0 &&
    entry.title.length <= LIMITS.title &&
    entry.excerpt.length <= LIMITS.excerpt
  );
}

function entriesForPartition(
  listings: readonly CatalogListing[],
  identifier: string,
): CatalogEntry[] {
  return listings
    .filter((listing) => listing.partitionIdentifier === identifier)
    .sort((a, b) => a.updatedAt - b.updatedAt || a.id.localeCompare(b.id))
    .map(listingToEntry);
}

/** Upsert by identifier so a rebuild can never duplicate or drop the new entry. */
function upsertEntry(entries: readonly CatalogEntry[], entry: CatalogEntry): CatalogEntry[] {
  return [...entries.filter((candidate) => candidate.identifier !== entry.identifier), entry];
}

function mergeLabels(existing: readonly string[], added: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const label of [...existing, ...added]) {
    const trimmed = label.trim();
    if (trimmed.length === 0 || trimmed.length > 120) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
    if (result.length >= MANIFEST_TAXONOMY_MAX) break;
  }
  return result;
}

function partitionIsFull(entries: readonly unknown[], payloadWithoutEntriesSize: number): boolean {
  if (entries.length >= CATALOG_PARTITION_CAPACITY) return true;
  const serializedLength = JSON.stringify({ entries }).length + payloadWithoutEntriesSize;
  return serializedLength > CATALOG_PARTITION_BYTE_BUDGET;
}

export interface PlanCatalogWriteOptions {
  readonly type: EntityKind;
  readonly entry: CatalogEntry;
  readonly publisherName: string;
  readonly compiledAt: number;
  readonly existing: ExistingCatalog;
  readonly checksumFn?: CatalogChecksumFn;
}

/**
 * Build the partition + manifest payloads for one catalog upsert.
 *
 * Handles the first-publication bootstrap (no manifest, no partition) exactly
 * like a later merge; a missing catalog is not an error that blocks publishing.
 * An entry that already exists (same identifier) is replaced, so a retry after a
 * partial failure cannot duplicate a catalog entry.
 */
export async function planCatalogWrite(
  options: PlanCatalogWriteOptions,
): Promise<CatalogWritePlan> {
  const { type, entry, publisherName, compiledAt, existing } = options;
  const checksumFn = options.checksumFn ?? defaultChecksum;
  const token = PARTITION_TOKEN_BY_KIND[type];

  if (!isStableId(entry.id)) throw new Error('Catalog entry id is not a stable id');

  const existingManifest = existing.manifest;
  const createdCatalog = existingManifest === null;
  const catalogVersion = createdCatalog ? 1 : existingManifest.catalogVersion + 1;
  const allDescriptors = existingManifest?.partitions ?? [];
  const typedDescriptorIds = new Set(
    allDescriptors
      .filter((descriptor) => descriptor.type === type)
      .map((descriptor) => descriptor.identifier),
  );

  // Listings of this type that belong to no known partition (for example a
  // resource restored from bounded discovery during an index repair) are
  // re-indexed into the target partition instead of being silently dropped from
  // the rebuilt manifest. Invalid candidates are ignored rather than allowed to
  // fail the whole plan.
  const unassignedEntries: CatalogEntry[] = [];
  for (const listing of existing.listings) {
    if (listing.type !== type) continue;
    if (typedDescriptorIds.has(listing.partitionIdentifier)) continue;
    const candidate = listingToEntry(listing);
    if (isPlannableEntry(candidate)) unassignedEntries.push(candidate);
  }

  // Existing partitions of this type, ordered by their numeric index.
  const typedPartitions: { identifier: string; index: number; entries: CatalogEntry[] }[] = [];
  for (const descriptor of allDescriptors) {
    if (descriptor.type !== type) continue;
    const index = partitionNumber(descriptor.identifier, token);
    if (index === null) continue;
    typedPartitions.push({
      identifier: descriptor.identifier,
      index,
      entries: entriesForPartition(existing.listings, descriptor.identifier),
    });
  }
  typedPartitions.sort((a, b) => a.index - b.index);

  // The partition that already holds this entry wins, so an upsert/retry cannot
  // duplicate an entry or move it between partitions.
  const holding = typedPartitions.find((partition) =>
    partition.entries.some((candidate) => candidate.identifier === entry.identifier),
  );

  let targetIdentifier: string;
  let targetPartitionIndex: number;
  let targetEntries: CatalogEntry[];

  if (holding) {
    targetIdentifier = holding.identifier;
    targetPartitionIndex = holding.index;
    targetEntries = upsertEntry([...holding.entries, ...unassignedEntries], entry);
  } else {
    const withRoom = [...typedPartitions]
      .reverse()
      .find((partition) => !partitionIsFull(partition.entries, 0));
    if (withRoom) {
      targetIdentifier = withRoom.identifier;
      targetPartitionIndex = withRoom.index;
      targetEntries = upsertEntry([...withRoom.entries, ...unassignedEntries], entry);
    } else {
      const nextIndex =
        typedPartitions.length === 0 ? 0 : typedPartitions[typedPartitions.length - 1].index + 1;
      if (nextIndex > 9999) {
        throw new Error('Catalog partition limit reached; a catalog rebuild is required');
      }
      targetPartitionIndex = nextIndex;
      targetIdentifier = `saw_cat_${token}_p${String(nextIndex).padStart(3, '0')}`;
      targetEntries = upsertEntry(unassignedEntries, entry);
    }
  }

  const partitionPayload: CatalogPartitionPayload = {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    kind: 'catalog-partition',
    type,
    partition: targetPartitionIndex,
    compiledAt,
    entries: targetEntries,
  };

  const checksum = await checksumFn(partitionPayload.entries);
  const maxUpdated = targetEntries.reduce(
    (max, candidate) => (candidate.updatedAt > max ? candidate.updatedAt : max),
    0,
  );

  const partitions = allDescriptors
    .filter((descriptor) => descriptor.identifier !== targetIdentifier)
    .map((descriptor) => ({ ...descriptor }));
  partitions.push({
    identifier: targetIdentifier,
    type,
    count: targetEntries.length,
    maxUpdated: maxUpdated > 0 ? maxUpdated : null,
    checksum,
  });
  partitions.sort((a, b) => a.identifier.localeCompare(b.identifier));

  const manifestPayload: CatalogManifestPayload = {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    kind: 'catalog-manifest',
    catalogVersion,
    compiledAt,
    publisherName,
    partitions,
    taxonomy: {
      categories: mergeLabels(existingManifest?.taxonomy.categories ?? [], entry.categories),
      tags: mergeLabels(existingManifest?.taxonomy.tags ?? [], entry.tags),
    },
  };

  return {
    partitionIdentifier: targetIdentifier,
    partition: partitionPayload,
    manifest: manifestPayload,
    manifestIdentifier: CATALOG_MANIFEST_IDENTIFIER,
    createdCatalog,
    catalogVersion,
  };
}

/**
 * Validate a planned write against the same runtime validators the read path
 * uses. This is the fail-closed gate before any catalog bytes are published.
 */
export function assertCatalogPlanValid(plan: CatalogWritePlan): void {
  const partition = validateCatalogPartition(
    plan.partition,
    plan.partition.type,
    plan.partitionIdentifier,
  );
  if (!partition.ok) {
    throw new Error(`Planned catalog partition is invalid: ${partition.message}`);
  }
  const manifest = validateCatalogManifest(plan.manifest);
  if (!manifest.ok) {
    throw new Error(`Planned catalog manifest is invalid: ${manifest.message}`);
  }
  const partitionBytes = JSON.stringify(plan.partition).length;
  if (partitionBytes > LIMITS.catalogBytes) {
    throw new Error('Planned catalog partition exceeds the app payload cap');
  }
  const manifestBytes = JSON.stringify(plan.manifest).length;
  if (manifestBytes > LIMITS.catalogBytes) {
    throw new Error('Planned catalog manifest exceeds the app payload cap');
  }
}
