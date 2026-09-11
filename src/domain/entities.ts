import {
  ENTITY_KINDS,
  ENTITY_STATES,
  LIMITS,
  SUPPORTED_SCHEMA_VERSION,
  type EntityKind,
  type EntityState,
} from './constants';
import { isStableId } from './identifiers';
import { validateRichTextDocument } from './richText';
import type {
  BlogPost,
  GalleryAlbum,
  GalleryItem,
  QdnMediaReference,
  ShadowArchiveEntity,
  VideoEntry,
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
  hasControlCharacters,
  requireStringAllowEmpty,
  validResourceIdentifier,
  validServiceName,
  type ValidationResult,
} from './validation';

const TAXONOMY_LABEL_MAX = 120;

/** Validate an explicit QDN media reference; returns null when unusable. */
export function validateMediaReference(value: unknown): QdnMediaReference | null {
  if (!isRecord(value)) return null;
  const service = validServiceName(value.service);
  const name = requireString(value.name, LIMITS.name);
  const identifier = validResourceIdentifier(value.identifier);
  if (!service || !name || !identifier) return null;

  const reference: {
    service: string;
    name: string;
    identifier: string;
    path?: string;
    mimeType?: string;
  } = { service, name, identifier };

  const path = optionalString(value.path, 1024);
  if (path !== null && !hasControlCharacters(path)) reference.path = path;
  const mimeType = optionalString(value.mimeType, 128);
  if (mimeType !== null) reference.mimeType = mimeType;
  return reference;
}

/** Read a bounded array of taxonomy labels, dropping unusable entries. */
export function readTaxonomyLabels(
  value: unknown,
  field: string,
): ValidationResult<readonly string[]> {
  if (value === undefined || value === null) return ok([]);
  const raw = boundedArray(value, LIMITS.taxonomyArray);
  if (!raw) {
    return fail(
      'invalid-value',
      `${field} must be an array of at most ${LIMITS.taxonomyArray} entries`,
    );
  }
  const labels: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const trimmed = entry.trim();
    if (trimmed.length === 0 || trimmed.length > TAXONOMY_LABEL_MAX) continue;
    labels.push(trimmed);
  }
  return ok(labels);
}

interface Envelope {
  readonly schemaVersion: number;
  readonly kind: EntityKind;
  readonly id: string;
  readonly publisher: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly state: EntityState;
}

export interface EntityValidationOptions {
  /** When supplied, the payload kind must equal this. */
  readonly expectedKind?: EntityKind;
}

function validateEnvelope(
  raw: Record<string, unknown>,
  options: EntityValidationOptions,
): ValidationResult<Envelope> {
  if (raw.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    return fail('unsupported-schema', `Unsupported schemaVersion: ${String(raw.schemaVersion)}`);
  }
  if (!isOneOf(raw.kind, ENTITY_KINDS)) {
    return fail('invalid-value', `Unknown entity kind: ${String(raw.kind)}`);
  }
  if (options.expectedKind && raw.kind !== options.expectedKind) {
    return fail('invalid-value', `Expected kind ${options.expectedKind}, received ${raw.kind}`);
  }
  if (!isStableId(raw.id)) {
    return fail('invalid-value', 'Entity id must be a 12-character base36 stable id');
  }
  if (!isOneOf(raw.state, ENTITY_STATES)) {
    return fail('invalid-value', `Unknown entity state: ${String(raw.state)}`);
  }
  const createdAt = nonNegativeInteger(raw.createdAt);
  const updatedAt = nonNegativeInteger(raw.updatedAt);
  if (createdAt === null || updatedAt === null) {
    return fail('invalid-value', 'Entity timestamps must be non-negative integers');
  }
  return ok({
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    kind: raw.kind,
    id: raw.id,
    publisher: optionalString(raw.publisher, LIMITS.name),
    createdAt,
    updatedAt,
    state: raw.state,
  });
}

function readRequiredMedia(value: unknown, field: string): ValidationResult<QdnMediaReference> {
  const reference = validateMediaReference(value);
  if (!reference) return fail('invalid-value', `${field} must be a valid QDN media reference`);
  return ok(reference);
}

function readNullableMedia(value: unknown): QdnMediaReference | null {
  if (value === undefined || value === null) return null;
  return validateMediaReference(value);
}

function validateBlogPost(
  envelope: Envelope,
  data: Record<string, unknown>,
): ValidationResult<BlogPost> {
  const title = requireString(data.title, LIMITS.title);
  const slug = requireString(data.slug, LIMITS.slug);
  const excerpt = requireStringAllowEmpty(data.excerpt, LIMITS.excerpt);
  const bodyText = requireStringAllowEmpty(data.bodyText, LIMITS.bodyText);
  const language = requireString(data.language, LIMITS.language);
  if (!title) return fail('invalid-value', 'Blog post title is required');
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return fail('invalid-value', 'Blog post slug is invalid');
  }
  if (excerpt === null) return fail('invalid-value', 'Blog post excerpt is invalid');
  if (bodyText === null) return fail('invalid-value', 'Blog post bodyText is invalid');
  if (!language) return fail('invalid-value', 'Blog post language is required');

  const body = validateRichTextDocument(data.body);
  if (!body.ok) return body;

  const categories = readTaxonomyLabels(data.categories, 'categories');
  if (!categories.ok) return categories;
  const tags = readTaxonomyLabels(data.tags, 'tags');
  if (!tags.ok) return tags;

  return ok({
    ...envelope,
    kind: 'blog-post',
    data: {
      title,
      slug,
      excerpt,
      body: body.value,
      bodyText,
      thumbnail: readNullableMedia(data.thumbnail),
      categories: categories.value,
      tags: tags.value,
      language,
    },
  });
}

function validateVideoEntry(
  envelope: Envelope,
  data: Record<string, unknown>,
): ValidationResult<VideoEntry> {
  const title = requireString(data.title, LIMITS.title);
  const slug = requireString(data.slug, LIMITS.slug);
  const description = requireStringAllowEmpty(data.description, LIMITS.description);
  const language = requireString(data.language, LIMITS.language);
  if (!title) return fail('invalid-value', 'Video title is required');
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    return fail('invalid-value', 'Video slug is invalid');
  }
  if (description === null) return fail('invalid-value', 'Video description is invalid');
  if (!language) return fail('invalid-value', 'Video language is required');

  const media = readRequiredMedia(data.media, 'media');
  if (!media.ok) return media;

  const durationSeconds = nonNegativeNumber(data.durationSeconds);
  if (durationSeconds === null) {
    return fail('invalid-value', 'Video durationSeconds must be a non-negative number');
  }

  const categories = readTaxonomyLabels(data.categories, 'categories');
  if (!categories.ok) return categories;
  const tags = readTaxonomyLabels(data.tags, 'tags');
  if (!tags.ok) return tags;

  return ok({
    ...envelope,
    kind: 'video',
    data: {
      title,
      slug,
      description,
      media: media.value,
      externalMedia: readNullableMedia(data.externalMedia),
      thumbnail: readNullableMedia(data.thumbnail),
      durationSeconds,
      categories: categories.value,
      tags: tags.value,
      language,
    },
  });
}

function validateGalleryItem(
  envelope: Envelope,
  data: Record<string, unknown>,
): ValidationResult<GalleryItem> {
  const title = requireString(data.title, LIMITS.title);
  const description = requireStringAllowEmpty(data.description, LIMITS.description);
  const language = requireString(data.language, LIMITS.language);
  if (!title) return fail('invalid-value', 'Gallery item title is required');
  if (description === null) return fail('invalid-value', 'Gallery item description is invalid');
  if (!language) return fail('invalid-value', 'Gallery item language is required');

  const media = readRequiredMedia(data.media, 'media');
  if (!media.ok) return media;

  const albumId = optionalString(data.albumId, 12);
  if (albumId !== null && !isStableId(albumId)) {
    return fail('invalid-value', 'Gallery item albumId must be a stable id');
  }

  const width = nonNegativeInteger(data.width);
  const height = nonNegativeInteger(data.height);
  if (width === null || height === null) {
    return fail('invalid-value', 'Gallery item dimensions must be non-negative integers');
  }

  const categories = readTaxonomyLabels(data.categories, 'categories');
  if (!categories.ok) return categories;
  const tags = readTaxonomyLabels(data.tags, 'tags');
  if (!tags.ok) return tags;

  return ok({
    ...envelope,
    kind: 'gallery-item',
    data: {
      title,
      description,
      albumId,
      media: media.value,
      thumbnail: readNullableMedia(data.thumbnail),
      width,
      height,
      categories: categories.value,
      tags: tags.value,
      language,
    },
  });
}

function validateGalleryAlbum(
  envelope: Envelope,
  data: Record<string, unknown>,
): ValidationResult<GalleryAlbum> {
  const title = requireString(data.title, LIMITS.title);
  const description = requireStringAllowEmpty(data.description, LIMITS.description);
  const language = requireString(data.language, LIMITS.language);
  if (!title) return fail('invalid-value', 'Gallery album title is required');
  if (description === null) return fail('invalid-value', 'Gallery album description is invalid');
  if (!language) return fail('invalid-value', 'Gallery album language is required');

  const categories = readTaxonomyLabels(data.categories, 'categories');
  if (!categories.ok) return categories;
  const tags = readTaxonomyLabels(data.tags, 'tags');
  if (!tags.ok) return tags;

  return ok({
    ...envelope,
    kind: 'gallery-album',
    data: {
      title,
      description,
      coverThumbnail: readNullableMedia(data.coverThumbnail),
      categories: categories.value,
      tags: tags.value,
      language,
    },
  });
}

/** Validate one entity payload. Never throws; malformed input returns a failure. */
export function validateEntityPayload(
  raw: unknown,
  options: EntityValidationOptions = {},
): ValidationResult<ShadowArchiveEntity> {
  if (!isRecord(raw)) return fail('not-an-object', 'Entity payload is not an object');
  const envelope = validateEnvelope(raw, options);
  if (!envelope.ok) return envelope;
  if (!isRecord(raw.data)) return fail('invalid-type', 'Entity data must be an object');

  switch (envelope.value.kind) {
    case 'blog-post':
      return validateBlogPost(envelope.value, raw.data);
    case 'video':
      return validateVideoEntry(envelope.value, raw.data);
    case 'gallery-item':
      return validateGalleryItem(envelope.value, raw.data);
    case 'gallery-album':
      return validateGalleryAlbum(envelope.value, raw.data);
  }
}
