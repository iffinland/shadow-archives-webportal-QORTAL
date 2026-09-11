/**
 * Shadow Archives QDN domain constants.
 *
 * These encode the owner-approved Phase 1A contract baseline
 * (`docs/shadow-archives-webportal/architecture/2026-09-11-qdn-data-contracts.md`).
 * Changing a value here is an architecture change, not a refactor.
 */

/** Only the current schema version is accepted; unknown versions are quarantined. */
export const SUPPORTED_SCHEMA_VERSION = 1;

/** Owner decision D1: fixed identifier namespace. Schema versions do not use it. */
export const IDENTIFIER_NAMESPACE = 'saw_';

/** Entity kinds. The token values match the contract's worked examples. */
export const ENTITY_KINDS = ['blog-post', 'video', 'gallery-item', 'gallery-album'] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

/** Identifier prefix per kind (contract §2.2). */
export const IDENTIFIER_PREFIX_BY_KIND: Readonly<Record<EntityKind, string>> = {
  'blog-post': 'saw_post_',
  video: 'saw_vid_',
  'gallery-item': 'saw_img_',
  'gallery-album': 'saw_album_',
};

export const IDENTIFIER_KIND_BY_PREFIX: Readonly<Record<string, EntityKind>> = {
  saw_post_: 'blog-post',
  saw_vid_: 'video',
  saw_img_: 'gallery-item',
  saw_album_: 'gallery-album',
};

/** Catalog identifiers (contract §2.2, §7.2). */
export const CATALOG_MANIFEST_IDENTIFIER = 'saw_cat_manifest';
export const CATALOG_PARTITION_PREFIX = 'saw_cat_';

/** Stable id: 12 characters of base36. */
export const STABLE_ID_PATTERN = /^[0-9a-z]{12}$/;

/** Entity identifiers are restricted to the `saw_` namespace characters. */
export const ENTITY_IDENTIFIER_PATTERN = /^[a-z0-9_]{1,64}$/;

/** Generic QDN resource identifier safety bound (Core caps identifiers at 64 bytes). */
export const RESOURCE_IDENTIFIER_MAX_LENGTH = 64;

/** Entity states (contract §4). */
export const ENTITY_STATES = ['active', 'inactive', 'withdrawn'] as const;
export type EntityState = (typeof ENTITY_STATES)[number];

/** Media/service token shape used for QDN references. */
export const MEDIA_SERVICE_PATTERN = /^[A-Z0-9_]{2,32}$/;

/** Self-imposed payload caps (contract §4: `DOCUMENT` has no Core cap). */
export const LIMITS = {
  entityBytes: 256 * 1024,
  catalogBytes: 1024 * 1024,
  title: 200,
  slug: 200,
  excerpt: 300,
  description: 2000,
  bodyText: 8 * 1024,
  language: 16,
  name: 128,
  taxonomyArray: 32,
  manifestPartitions: 64,
  partitionEntries: 512,
  richTextDepth: 40,
  richTextNodes: 5000,
  richTextTextChars: 200_000,
  searchPageSize: 20,
  searchMaxPages: 20,
  partitionConcurrency: 3,
  entityConcurrency: 4,
} as const;

/** Freshness window for cached catalog/entity reads (success TTL only). */
export const CACHE_TTL_MS = {
  catalogManifest: 5 * 60 * 1000,
  catalogPartition: 5 * 60 * 1000,
  entity: 5 * 60 * 1000,
} as const;
