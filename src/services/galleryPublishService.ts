/**
 * Shadow Archives Gallery publication (Phase 3A).
 *
 * This is the only module that turns a Gallery draft into QDN writes. It owns:
 * authority re-verification immediately before every write, the staged publish
 * order (media → thumbnail → entity → catalog partition → manifest), truthful
 * partial/timeout reporting, and cache invalidation.
 *
 * It is imported only from the lazy Gallery-owner boundary. Public visitors and
 * the startup graph never load it, `qortal/publish` or the image pipeline.
 *
 * Verified write contracts (re-verified 2026-09-12, Core `108bf191` v6.1.9 /
 * Hub `12a573b2`): see `qortal/publish.ts`. Single vs grouped decision: see
 * the Phase 3A report — grouped publication is used per stage so the owner gets
 * one host approval per stage while the entity/catalog ordering stays enforced.
 */

import { LIMITS, type EntityKind } from '../domain/constants';
import { validateEntityPayload } from '../domain/entities';
import {
  buildEntityIdentifier,
  buildGalleryMediaIdentifier,
  buildGalleryThumbnailIdentifier,
  generateUniqueStableId,
  type RandomBytes,
} from '../domain/identifiers';
import type { GalleryAlbum, GalleryItem, QdnMediaReference } from '../domain/types';
import { getNameData } from '../qortal/auth';
import { QortalBridgeError } from '../qortal/bridge';
import {
  bridgePublishPort,
  type PublishAttempt,
  type PublishFailure,
  type PublishPort,
  type PublishSubmission,
} from '../qortal/publish';
import type { CapabilityState, QdnEnvironment, QortalAccount } from '../qortal/types';
import { blobToBase64, utf8ToBase64 } from './base64';
import { getContentCache, type ContentCache } from './cache';
import {
  assertCatalogPlanValid,
  catalogEntryFromGalleryAlbum,
  catalogEntryFromGalleryItem,
  planCatalogWrite,
  type CatalogChecksumFn,
  type CatalogWritePlan,
} from './catalogWriter';
import { invalidateCatalogCache, loadCatalog } from './catalogRepository';
import { invalidateEntityCache } from './contentRepository';
import { findExactResource, type ExpectedIdentity } from './identity';
import {
  browserImageProcessingDeps,
  ImageProcessingError,
  processGalleryImage,
  type GalleryImageProcessingResult,
  type ImageProcessingDeps,
} from './imageProcessing';
import { bridgeQdnReadPort, parseJsonPayload, type QdnReadPort } from './qdnReader';

/* -------------------------------------------------------------------------- */
/* Input, context and result types                                            */
/* -------------------------------------------------------------------------- */

/** Owner/authority context supplied by the React layer from the real providers. */
export interface OwnerWriteContext {
  readonly capability: CapabilityState;
  readonly account: QortalAccount | null;
  readonly environment: QdnEnvironment;
}

export interface GalleryImageDraft {
  readonly file: File;
  readonly title: string;
  readonly description: string;
  readonly albumId: string | null;
  readonly categories: readonly string[];
  readonly tags: readonly string[];
  readonly language: string;
  /**
   * Retained across retries so resubmitting the same draft reuses the same
   * identity instead of creating a second item.
   */
  readonly id?: string;
}

export interface GalleryAlbumDraft {
  readonly title: string;
  readonly description: string;
  readonly categories: readonly string[];
  readonly tags: readonly string[];
  readonly language: string;
  readonly id?: string;
}

export type GalleryPublishStep =
  | 'preparing-media'
  | 'checking-authority'
  | 'awaiting-approval'
  | 'publishing-media'
  | 'publishing-metadata'
  | 'updating-index'
  | 'confirming';

export interface GalleryPublishProgress {
  readonly step: GalleryPublishStep;
  readonly label: string;
  readonly detail?: string;
  /** 1-based position and total for the concrete plan being executed. */
  readonly index: number;
  readonly total: number;
}

export type GalleryPublishStatus =
  'published' | 'index-incomplete' | 'partial' | 'ambiguous' | 'failed';

export interface GalleryPublicationResult {
  readonly status: GalleryPublishStatus;
  /** Owner-facing truthful summary; never claims more than the evidence supports. */
  readonly message: string;
  readonly kind: 'gallery-item' | 'gallery-album';
  readonly id: string;
  readonly entityIdentifier: string;
  readonly mediaIdentifier: string | null;
  readonly thumbnailIdentifier: string | null;
  readonly submissions: readonly PublishSubmission[];
  readonly failures: readonly PublishFailure[];
  readonly indexUpdated: boolean;
  /** Submission signature of the authoritative entity resource, when returned. */
  readonly entitySignature: string | null;
  /** True when the item was confirmed present by a bounded read after submission. */
  readonly entityConfirmed: boolean;
  /** The exact entity payload that was (or would be) written; enables strong verification. */
  readonly entityPayload: unknown;
}

export type GalleryPublishErrorCode =
  | 'not-hosted'
  | 'not-owner'
  | 'authority-unresolved'
  | 'authority-changed'
  | 'invalid-input'
  | 'image-processing'
  | 'id-generation-failed'
  | 'payload-too-large'
  | 'unexpected';

export class GalleryPublishError extends Error {
  readonly code: GalleryPublishErrorCode;

  constructor(code: GalleryPublishErrorCode, message: string) {
    super(message);
    this.name = 'GalleryPublishError';
    this.code = code;
  }
}

export interface GalleryPublishDeps {
  readonly reader: QdnReadPort;
  readonly writer: PublishPort;
  readonly cache: ContentCache;
  readonly now: () => number;
  readonly random?: RandomBytes;
  readonly checksumFn?: CatalogChecksumFn;
  readonly imageDeps?: ImageProcessingDeps;
}

/** Default dependencies: the injected bridge for reads/writes and the shared cache. */
export function createGalleryPublishDeps(
  overrides: Partial<GalleryPublishDeps> = {},
): GalleryPublishDeps {
  return {
    reader: overrides.reader ?? bridgeQdnReadPort,
    writer: overrides.writer ?? bridgePublishPort,
    cache: overrides.cache ?? getContentCache(),
    now: overrides.now ?? (() => Date.now()),
    random: overrides.random,
    checksumFn: overrides.checksumFn,
    imageDeps: overrides.imageDeps ?? browserImageProcessingDeps,
  };
}

export interface PublishGalleryImageOptions {
  readonly onProgress?: (progress: GalleryPublishProgress) => void;
  readonly onPrepared?: (prepared: GalleryImageProcessingResult) => void;
}

/* -------------------------------------------------------------------------- */
/* Authority                                                                  */
/* -------------------------------------------------------------------------- */

function authorityCheck(ctx: OwnerWriteContext, publisherName: string): void {
  if (!ctx.environment.bridgeAvailable || !ctx.environment.isHosted || ctx.environment.isProxy) {
    throw new GalleryPublishError(
      'not-hosted',
      'Gallery publishing requires the app to run inside a real Qortal host.',
    );
  }
  if (ctx.capability !== 'owner') {
    throw new GalleryPublishError(
      'not-owner',
      'Gallery publishing requires a positively verified owner capability.',
    );
  }
  if (!ctx.account) {
    throw new GalleryPublishError(
      'authority-unresolved',
      'No connected Qortal account is available.',
    );
  }
  if (!publisherName || ctx.environment.publisherName !== publisherName) {
    throw new GalleryPublishError(
      'authority-unresolved',
      'The publishing name could not be derived from the app identity.',
    );
  }
}

/**
 * Fresh ownership proof, run immediately before every write. A name transfer
 * between the initial capability check and the write must block the write.
 */
async function assertAuthorityFresh(ctx: OwnerWriteContext, publisherName: string): Promise<void> {
  authorityCheck(ctx, publisherName);
  const account = ctx.account;
  if (!account) {
    throw new GalleryPublishError(
      'authority-unresolved',
      'No connected Qortal account is available.',
    );
  }
  let owner: string | null;
  try {
    const data = await getNameData(publisherName);
    owner = data?.owner ?? null;
  } catch {
    owner = null;
  }
  if (!owner) {
    throw new GalleryPublishError(
      'authority-unresolved',
      'Current ownership of the publishing name could not be re-established.',
    );
  }
  if (owner !== account.address) {
    throw new GalleryPublishError(
      'authority-changed',
      'The connected account no longer owns the publishing name, so nothing was published.',
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const CORE_METADATA_TITLE_MAX = 80;
const CORE_METADATA_DESCRIPTION_MAX = 240;
const CORE_METADATA_TAG_MAX = 20;
const CORE_METADATA_TAG_COUNT = 5;

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

/** Mirror app taxonomy into Core metadata within the verified Core limits. */
export function coreMetadataTags(tags: readonly string[]): string[] {
  const result: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    if (trimmed.length === 0 || trimmed.length > CORE_METADATA_TAG_MAX) continue;
    if (result.length >= CORE_METADATA_TAG_COUNT) break;
    result.push(trimmed);
  }
  return result;
}

interface MirrorMetadata {
  readonly title: string;
  readonly description: string;
  readonly tags: readonly string[];
}

function mirrorMetadata(
  title: string,
  description: string,
  tags: readonly string[],
): MirrorMetadata {
  return {
    title: truncate(title, CORE_METADATA_TITLE_MAX),
    description: truncate(description, CORE_METADATA_DESCRIPTION_MAX),
    tags: coreMetadataTags(tags),
  };
}

async function documentData64(payload: unknown, capBytes: number): Promise<string> {
  const text = JSON.stringify(payload);
  const byteLength = new TextEncoder().encode(text).length;
  if (byteLength > capBytes) {
    throw new GalleryPublishError(
      'payload-too-large',
      `The generated payload is ${byteLength} bytes, above the ${capBytes}-byte app limit.`,
    );
  }
  return utf8ToBase64(text);
}

function mediaRef(
  service: string,
  name: string,
  identifier: string,
  mimeType?: string,
): QdnMediaReference {
  return mimeType ? { service, name, identifier, mimeType } : { service, name, identifier };
}

/* -------------------------------------------------------------------------- */
/* Preparation                                                                */
/* -------------------------------------------------------------------------- */

interface CatalogContext {
  /** `null` when the index cannot be safely updated (see `catalogSkipReason`). */
  readonly plan: CatalogWritePlan | null;
  readonly skipReason: string | null;
}

interface CatalogContextBase {
  readonly existing: {
    readonly manifest: import('../domain/types').CatalogManifest | null;
    readonly listings: readonly import('../domain/types').CatalogListing[];
  };
  /** Non-null when the derived index must NOT be rewritten this time. */
  readonly skipReason: string | null;
}

/**
 * Read the current derived index before any write.
 *
 * Only a genuinely missing catalog is bootstrapped. A catalog that is invalid,
 * unreadable or only partially readable is left untouched, because republishing
 * it from a partial view could drop entries; the authoritative content is still
 * published and the read path falls back to a prefix scan.
 */
async function readCatalogContext(
  deps: GalleryPublishDeps,
  publisherName: string,
): Promise<CatalogContextBase> {
  const catalog = await loadCatalog(deps.reader, deps.cache, publisherName, {
    now: deps.now(),
    force: true,
  });

  if (catalog.kind === 'error') {
    return {
      existing: { manifest: null, listings: [] },
      skipReason:
        'The Gallery index could not be read, so it was left untouched. The content itself is published and discoverable by the fallback scan.',
    };
  }
  if (catalog.kind === 'invalid') {
    return {
      existing: { manifest: null, listings: [] },
      skipReason:
        'The Gallery index is invalid or uses an unsupported version, so it was left untouched to avoid overwriting it.',
    };
  }
  if (catalog.kind === 'loaded' && (catalog.partial || catalog.rejectedEntries > 0)) {
    return {
      existing: { manifest: null, listings: [] },
      skipReason:
        'The Gallery index could not be read completely, so it was left untouched to avoid dropping existing entries.',
    };
  }
  return {
    existing:
      catalog.kind === 'loaded'
        ? { manifest: catalog.manifest, listings: catalog.listings }
        : { manifest: null, listings: [] },
    skipReason: null,
  };
}

async function planCatalogFromContext(
  deps: GalleryPublishDeps,
  publisherName: string,
  type: EntityKind,
  entry: Parameters<typeof planCatalogWrite>[0]['entry'],
  base: CatalogContextBase,
): Promise<CatalogContext> {
  if (base.skipReason) return { plan: null, skipReason: base.skipReason };
  try {
    const plan = await planCatalogWrite({
      type,
      entry,
      publisherName,
      compiledAt: deps.now(),
      existing: base.existing,
      checksumFn: deps.checksumFn,
    });
    assertCatalogPlanValid(plan);
    return { plan, skipReason: null };
  } catch (error) {
    // The catalog is derived and the entity is authoritative: a planning or
    // validation failure must never block the content write. Skip the index and
    // report it truthfully instead.
    const detail = error instanceof Error ? error.message : 'unknown error';
    return {
      plan: null,
      skipReason: `The Gallery index could not be prepared for this publication (${detail}), so it was left untouched.`,
    };
  }
}

async function idIsTaken(
  deps: GalleryPublishDeps,
  publisherName: string,
  kind: EntityKind,
  id: string,
  knownIds: ReadonlySet<string>,
): Promise<boolean> {
  if (knownIds.has(id)) return true;
  const identifier = buildEntityIdentifier(kind, id);
  const lookup = await findExactResource(deps.reader, {
    service: 'DOCUMENT',
    name: publisherName,
    identifier,
  });
  return lookup.kind === 'found';
}

/* -------------------------------------------------------------------------- */
/* Resource payload builders                                                  */
/* -------------------------------------------------------------------------- */

interface PlannedResources {
  readonly media: { readonly identifier: string; readonly payload: Record<string, unknown> };
  readonly thumbnail: { readonly identifier: string; readonly payload: Record<string, unknown> };
  readonly entity: { readonly identifier: string; readonly payload: Record<string, unknown> };
  /** Derived-index resources; assigned only when a valid catalog plan exists. */
  catalog: {
    readonly partitionIdentifier: string;
    readonly resources: Record<string, unknown>[];
  } | null;
}

/* -------------------------------------------------------------------------- */
/* Publication                                                                */
/* -------------------------------------------------------------------------- */

function failResult(
  kind: 'gallery-item' | 'gallery-album',
  id: string,
  entityIdentifier: string,
  partial: { mediaIdentifier: string | null; thumbnailIdentifier: string | null },
  status: GalleryPublishStatus,
  message: string,
  attempt: PublishAttempt,
  entityPayload: unknown,
  indexUpdated: boolean,
  entityConfirmed: boolean,
): GalleryPublicationResult {
  return {
    status,
    message,
    kind,
    id,
    entityIdentifier,
    mediaIdentifier: partial.mediaIdentifier,
    thumbnailIdentifier: partial.thumbnailIdentifier,
    submissions:
      attempt.kind === 'submitted' || attempt.kind === 'partial' ? attempt.submissions : [],
    failures: attempt.kind === 'partial' || attempt.kind === 'failed' ? attempt.failures : [],
    indexUpdated,
    entitySignature: null,
    entityConfirmed,
    entityPayload,
  };
}

interface StageOutcome {
  readonly ok: boolean;
  readonly attempt: PublishAttempt | null;
  readonly failureMessage: string | null;
}

/** Emits monotonic, truthful step counters for the concrete plan being executed. */
interface ProgressEmitter {
  (step: GalleryPublishStep, label: string, detail?: string): void;
}

function createProgressEmitter(
  onProgress: ((progress: GalleryPublishProgress) => void) | undefined,
  total: number,
): ProgressEmitter {
  let index = 0;
  return (step, label, detail) => {
    index = Math.min(index + 1, total);
    onProgress?.({ step, label, detail, index, total });
  };
}

async function runStage(
  ctx: OwnerWriteContext,
  deps: GalleryPublishDeps,
  publisherName: string,
  step: 'publishing-media' | 'publishing-metadata' | 'updating-index',
  resources: readonly Record<string, unknown>[],
  emit: ProgressEmitter,
): Promise<StageOutcome> {
  emit('checking-authority', 'Checking owner authority');
  await assertAuthorityFresh(ctx, publisherName);

  emit(
    'awaiting-approval',
    'Awaiting Qortal approval',
    'The Qortal host will ask you to approve the resource fee.',
  );
  emit(step, stageLabel(step));

  const typed = resources as unknown as Parameters<PublishPort['publishResources']>[0];
  const attempt =
    resources.length === 1
      ? await deps.writer.publishResource(typed[0])
      : await deps.writer.publishResources(typed);

  if (attempt.kind === 'submitted') return { ok: true, attempt, failureMessage: null };
  if (attempt.kind === 'partial') {
    const failed = attempt.failures.map((failure) => failure.identifier ?? 'unknown').join(', ');
    return {
      ok: false,
      attempt,
      failureMessage: `Some resources were not published (${failed}).`,
    };
  }
  if (attempt.kind === 'ambiguous') {
    return {
      ok: false,
      attempt,
      failureMessage:
        'The submission timed out. The host may still have published it, so nothing was retried automatically.',
    };
  }
  return {
    ok: false,
    attempt,
    failureMessage: attempt.failures[0]?.reason ?? attempt.error.message,
  };
}

function stageLabel(step: string): string {
  switch (step) {
    case 'publishing-media':
      return 'Publishing media and thumbnail';
    case 'publishing-metadata':
      return 'Publishing metadata';
    case 'updating-index':
      return 'Updating the Gallery index';
    default:
      return 'Publishing';
  }
}

function attemptStatus(attempt: PublishAttempt | null): GalleryPublishStatus {
  if (!attempt) return 'failed';
  if (attempt.kind === 'ambiguous') return 'ambiguous';
  if (attempt.kind === 'partial') return 'partial';
  return 'failed';
}

async function confirmEntity(
  deps: GalleryPublishDeps,
  identity: ExpectedIdentity,
  emit: ProgressEmitter,
): Promise<boolean> {
  emit('confirming', 'Confirming the published item');
  try {
    const lookup = await findExactResource(deps.reader, identity, {
      requestOptions: { timeoutMs: 15_000 },
    });
    return lookup.kind === 'found';
  } catch {
    return false;
  }
}

async function invalidateAfterPublish(
  deps: GalleryPublishDeps,
  publisherName: string,
  entityIdentifier: string,
  catalog: CatalogContext,
): Promise<void> {
  try {
    await invalidateEntityCache(deps.cache, publisherName, [entityIdentifier]);
    await invalidateCatalogCache(deps.cache, publisherName, {
      manifest: catalog.plan !== null,
      partitions: catalog.plan ? [catalog.plan.partitionIdentifier] : [],
    });
  } catch {
    // A cache-invalidation failure must never turn a successful publication into
    // a reported failure; the next read simply revalidates.
  }
}

/* -------------------------------------------------------------------------- */
/* Public API                                                                 */
/* -------------------------------------------------------------------------- */

export async function publishGalleryImage(
  ctx: OwnerWriteContext,
  draft: GalleryImageDraft,
  options: PublishGalleryImageOptions = {},
  deps: GalleryPublishDeps = createGalleryPublishDeps(),
): Promise<GalleryPublicationResult> {
  const publisherName = ctx.environment.publisherName;
  if (!publisherName) {
    throw new GalleryPublishError('authority-unresolved', 'No publishing name is available.');
  }
  if (!draft.title.trim()) {
    throw new GalleryPublishError('invalid-input', 'A title is required.');
  }

  // Pre-write authority gate: nothing (including image processing) starts until
  // the session is a verified owner in a real host.
  authorityCheck(ctx, publisherName);

  // Read the derived index before any write so an unreadable catalog is detected
  // up front (it must not block the authoritative content write) and the progress
  // counter can describe the concrete plan truthfully.
  const catalogBase = await readCatalogContext(deps, publisherName);
  const emit = createProgressEmitter(options.onProgress, catalogBase.skipReason ? 8 : 11);
  emit('preparing-media', 'Preparing image and thumbnail');
  let processed: GalleryImageProcessingResult;
  try {
    processed = await processGalleryImage(draft.file, deps.imageDeps);
  } catch (error) {
    if (error instanceof ImageProcessingError) {
      throw new GalleryPublishError('image-processing', error.message);
    }
    throw new GalleryPublishError('image-processing', 'The image could not be prepared.');
  }
  options.onPrepared?.(processed);

  const now = deps.now();
  const taken = async (id: string): Promise<boolean> =>
    idIsTaken(deps, publisherName, 'gallery-item', id, new Set<string>());
  let id: string;
  if (draft.id) {
    id = draft.id;
  } else {
    try {
      id = await generateUniqueStableId(taken, { random: deps.random });
    } catch {
      throw new GalleryPublishError(
        'id-generation-failed',
        'A unique Gallery id could not be generated.',
      );
    }
  }

  const entityIdentifier = buildEntityIdentifier('gallery-item', id);
  const mediaIdentifier = buildGalleryMediaIdentifier(id);
  const thumbnailIdentifier = buildGalleryThumbnailIdentifier(id);

  const data = {
    title: draft.title.trim(),
    description: draft.description.trim(),
    albumId: draft.albumId,
    media: mediaRef('IMAGE', publisherName, mediaIdentifier, processed.full.mimeType),
    thumbnail: mediaRef(
      'THUMBNAIL',
      publisherName,
      thumbnailIdentifier,
      processed.thumbnail.mimeType,
    ),
    width: processed.full.width,
    height: processed.full.height,
    categories: [...draft.categories],
    tags: [...draft.tags],
    language: draft.language,
  };

  const entityPayload = {
    schemaVersion: 1,
    kind: 'gallery-item' as const,
    id,
    publisher: publisherName,
    createdAt: now,
    updatedAt: now,
    state: 'active' as const,
    data,
  };

  const validated = validateEntityPayload(entityPayload, { expectedKind: 'gallery-item' });
  if (!validated.ok) {
    throw new GalleryPublishError(
      'invalid-input',
      `The Gallery item is invalid: ${validated.message}`,
    );
  }
  const entity = validated.value as GalleryItem;

  // Plan the derived index before any write so an unreadable catalog cannot
  // block the authoritative content write.
  const contentHash = await safeContentHash(deps, data);
  const catalog = await planCatalogFromContext(
    deps,
    publisherName,
    'gallery-item',
    catalogEntryFromGalleryItem(entity, contentHash),
    catalogBase,
  );

  const mediaBase64 = await blobToBase64(processed.full.blob);
  const thumbnailBase64 = await blobToBase64(processed.thumbnail.blob);
  const metadata = mirrorMetadata(entity.data.title, entity.data.description, entity.data.tags);

  const resources: PlannedResources = {
    media: {
      identifier: mediaIdentifier,
      payload: {
        service: 'IMAGE',
        name: publisherName,
        identifier: mediaIdentifier,
        data64: mediaBase64,
        filename: `saw-img-${id}.${extensionForMime(processed.full.mimeType)}`,
        ...metadata,
      },
    },
    thumbnail: {
      identifier: thumbnailIdentifier,
      payload: {
        service: 'THUMBNAIL',
        name: publisherName,
        identifier: thumbnailIdentifier,
        data64: thumbnailBase64,
        filename: `saw-img-${id}-thumb.${extensionForMime(processed.thumbnail.mimeType)}`,
      },
    },
    entity: {
      identifier: entityIdentifier,
      payload: {
        service: 'DOCUMENT',
        name: publisherName,
        identifier: entityIdentifier,
        data64: await documentData64(entityPayload, LIMITS.entityBytes),
        filename: `${entityIdentifier}.json`,
        ...metadata,
      },
    },
    catalog: null,
  };

  if (catalog.plan) {
    resources.catalog = {
      partitionIdentifier: catalog.plan.partitionIdentifier,
      resources: [
        {
          service: 'DOCUMENT',
          name: publisherName,
          identifier: catalog.plan.partitionIdentifier,
          data64: await documentData64(catalog.plan.partition, LIMITS.catalogBytes),
          filename: `${catalog.plan.partitionIdentifier}.json`,
          title: 'Shadow Archives Gallery index',
        },
        {
          service: 'DOCUMENT',
          name: publisherName,
          identifier: catalog.plan.manifestIdentifier,
          data64: await documentData64(catalog.plan.manifest, LIMITS.catalogBytes),
          filename: `${catalog.plan.manifestIdentifier}.json`,
          title: 'Shadow Archives catalog manifest',
        },
      ],
    };
  }

  // Stage 1: media + thumbnail. The entity must not be written unless the bytes
  // it references exist.
  const mediaStage = await runStage(
    ctx,
    deps,
    publisherName,
    'publishing-media',
    [resources.media.payload, resources.thumbnail.payload],
    emit,
  );
  if (!mediaStage.ok || !mediaStage.attempt) {
    await invalidateAfterPublish(deps, publisherName, entityIdentifier, catalog);
    return failResult(
      'gallery-item',
      id,
      entityIdentifier,
      { mediaIdentifier, thumbnailIdentifier },
      attemptStatus(mediaStage.attempt),
      mediaStage.failureMessage ?? 'The gallery media was not published.',
      mediaStage.attempt ?? {
        kind: 'failed',
        error: new QortalBridgeError('error', 'Publish failed', 'PUBLISH_MULTIPLE_QDN_RESOURCES'),
        failures: [],
      },
      entityPayload,
      false,
      false,
    );
  }

  // Stage 2: the authoritative entity.
  const entityStage = await runStage(
    ctx,
    deps,
    publisherName,
    'publishing-metadata',
    [resources.entity.payload],
    emit,
  );
  if (!entityStage.ok || !entityStage.attempt) {
    await invalidateAfterPublish(deps, publisherName, entityIdentifier, catalog);
    return failResult(
      'gallery-item',
      id,
      entityIdentifier,
      { mediaIdentifier, thumbnailIdentifier },
      attemptStatus(entityStage.attempt),
      entityStage.attempt?.kind === 'ambiguous'
        ? 'The metadata submission timed out. The item may have been published; verify before retrying.'
        : (entityStage.failureMessage ?? 'The gallery item metadata was not published.'),
      entityStage.attempt ?? {
        kind: 'failed',
        error: new QortalBridgeError('error', 'Publish failed', 'PUBLISH_QDN_RESOURCE'),
        failures: [],
      },
      entityPayload,
      false,
      false,
    );
  }

  const entitySignature =
    entityStage.attempt.kind === 'submitted' || entityStage.attempt.kind === 'partial'
      ? (entityStage.attempt.submissions[0]?.signature ?? null)
      : null;
  const entityConfirmed = await confirmEntity(
    deps,
    { service: 'DOCUMENT', name: publisherName, identifier: entityIdentifier },
    emit,
  );

  // Stage 3: derived index (partition + manifest).
  let indexUpdated = false;
  let indexFailure: readonly PublishFailure[] = [];
  let indexAmbiguous = false;
  let indexMessage: string | null = catalog.skipReason;

  if (resources.catalog) {
    const indexStage = await runStage(
      ctx,
      deps,
      publisherName,
      'updating-index',
      resources.catalog.resources,
      emit,
    );
    if (indexStage.ok) {
      indexUpdated = true;
    } else {
      if (indexStage.attempt?.kind === 'partial') indexFailure = indexStage.attempt.failures;
      if (indexStage.attempt?.kind === 'ambiguous') indexAmbiguous = true;
      indexMessage = indexStage.failureMessage ?? 'The Gallery index could not be updated.';
    }
  }

  await invalidateAfterPublish(deps, publisherName, entityIdentifier, catalog);

  const submissions = [
    ...(mediaStage.attempt.kind === 'submitted' || mediaStage.attempt.kind === 'partial'
      ? mediaStage.attempt.submissions
      : []),
    ...(entityStage.attempt.kind === 'submitted' || entityStage.attempt.kind === 'partial'
      ? entityStage.attempt.submissions
      : []),
  ];

  if (indexUpdated) {
    return {
      status: 'published',
      message: entityConfirmed
        ? 'Published. The Gallery item is available.'
        : 'Published. The item is submitted; availability is still being confirmed.',
      kind: 'gallery-item',
      id,
      entityIdentifier,
      mediaIdentifier,
      thumbnailIdentifier,
      submissions,
      failures: [],
      indexUpdated: true,
      entitySignature,
      entityConfirmed,
      entityPayload,
    };
  }

  return {
    status: 'index-incomplete' as const,
    message: indexAmbiguous
      ? 'Content published, index update unconfirmed (the index submission timed out). The item is authoritative and can be found by the fallback scan.'
      : `Content published, index update incomplete. ${indexMessage ?? ''}`.trim(),
    kind: 'gallery-item',
    id,
    entityIdentifier,
    mediaIdentifier,
    thumbnailIdentifier,
    submissions,
    failures: indexFailure,
    indexUpdated: false,
    entitySignature,
    entityConfirmed,
    entityPayload,
  };
}

export async function publishGalleryAlbum(
  ctx: OwnerWriteContext,
  draft: GalleryAlbumDraft,
  options: { readonly onProgress?: (progress: GalleryPublishProgress) => void } = {},
  deps: GalleryPublishDeps = createGalleryPublishDeps(),
): Promise<GalleryPublicationResult> {
  const publisherName = ctx.environment.publisherName;
  if (!publisherName) {
    throw new GalleryPublishError('authority-unresolved', 'No publishing name is available.');
  }
  if (!draft.title.trim()) {
    throw new GalleryPublishError('invalid-input', 'A title is required.');
  }

  authorityCheck(ctx, publisherName);

  const catalogBase = await readCatalogContext(deps, publisherName);
  const emit = createProgressEmitter(options.onProgress, catalogBase.skipReason ? 4 : 7);

  const now = deps.now();
  const taken = async (id: string): Promise<boolean> =>
    idIsTaken(deps, publisherName, 'gallery-album', id, new Set<string>());
  let id: string;
  if (draft.id) {
    id = draft.id;
  } else {
    try {
      id = await generateUniqueStableId(taken, { random: deps.random });
    } catch {
      throw new GalleryPublishError(
        'id-generation-failed',
        'A unique album id could not be generated.',
      );
    }
  }

  const entityIdentifier = buildEntityIdentifier('gallery-album', id);
  const entityPayload = {
    schemaVersion: 1,
    kind: 'gallery-album' as const,
    id,
    publisher: publisherName,
    createdAt: now,
    updatedAt: now,
    state: 'active' as const,
    data: {
      title: draft.title.trim(),
      description: draft.description.trim(),
      coverThumbnail: null,
      categories: [...draft.categories],
      tags: [...draft.tags],
      language: draft.language,
    },
  };

  const validated = validateEntityPayload(entityPayload, { expectedKind: 'gallery-album' });
  if (!validated.ok) {
    throw new GalleryPublishError('invalid-input', `The album is invalid: ${validated.message}`);
  }
  const album = validated.value as GalleryAlbum;

  const contentHash = await safeContentHash(deps, album.data);
  const catalog = await planCatalogFromContext(
    deps,
    publisherName,
    'gallery-album',
    catalogEntryFromGalleryAlbum(album, contentHash),
    catalogBase,
  );

  const metadata = mirrorMetadata(album.data.title, album.data.description, album.data.tags);
  const entityResource = {
    service: 'DOCUMENT',
    name: publisherName,
    identifier: entityIdentifier,
    data64: await documentData64(entityPayload, LIMITS.entityBytes),
    filename: `${entityIdentifier}.json`,
    ...metadata,
  };

  const entityStage = await runStage(
    ctx,
    deps,
    publisherName,
    'publishing-metadata',
    [entityResource],
    emit,
  );
  if (!entityStage.ok || !entityStage.attempt) {
    await invalidateAfterPublish(deps, publisherName, entityIdentifier, catalog);
    return failResult(
      'gallery-album',
      id,
      entityIdentifier,
      { mediaIdentifier: null, thumbnailIdentifier: null },
      attemptStatus(entityStage.attempt),
      entityStage.attempt?.kind === 'ambiguous'
        ? 'The album submission timed out. It may have been published; verify before retrying.'
        : (entityStage.failureMessage ?? 'The album was not published.'),
      entityStage.attempt ?? {
        kind: 'failed',
        error: new QortalBridgeError('error', 'Publish failed', 'PUBLISH_QDN_RESOURCE'),
        failures: [],
      },
      entityPayload,
      false,
      false,
    );
  }

  const entityConfirmed = await confirmEntity(
    deps,
    { service: 'DOCUMENT', name: publisherName, identifier: entityIdentifier },
    emit,
  );

  let indexUpdated = false;
  let indexFailures: readonly PublishFailure[] = [];
  let indexAmbiguous = false;
  let indexMessage: string | null = catalog.skipReason;

  if (catalog.plan) {
    const indexStage = await runStage(
      ctx,
      deps,
      publisherName,
      'updating-index',
      [
        {
          service: 'DOCUMENT',
          name: publisherName,
          identifier: catalog.plan.partitionIdentifier,
          data64: await documentData64(catalog.plan.partition, LIMITS.catalogBytes),
          filename: `${catalog.plan.partitionIdentifier}.json`,
          title: 'Shadow Archives album index',
        },
        {
          service: 'DOCUMENT',
          name: publisherName,
          identifier: catalog.plan.manifestIdentifier,
          data64: await documentData64(catalog.plan.manifest, LIMITS.catalogBytes),
          filename: `${catalog.plan.manifestIdentifier}.json`,
          title: 'Shadow Archives catalog manifest',
        },
      ],
      emit,
    );
    if (indexStage.ok) {
      indexUpdated = true;
    } else {
      if (indexStage.attempt?.kind === 'partial') indexFailures = indexStage.attempt.failures;
      if (indexStage.attempt?.kind === 'ambiguous') indexAmbiguous = true;
      indexMessage = indexStage.failureMessage ?? 'The Gallery index could not be updated.';
    }
  }

  await invalidateAfterPublish(deps, publisherName, entityIdentifier, catalog);

  const submissions =
    entityStage.attempt.kind === 'submitted' || entityStage.attempt.kind === 'partial'
      ? entityStage.attempt.submissions
      : [];

  if (indexUpdated) {
    return {
      status: 'published',
      message: entityConfirmed
        ? 'Published. The album is available.'
        : 'Published. The album is submitted; availability is still being confirmed.',
      kind: 'gallery-album',
      id,
      entityIdentifier,
      mediaIdentifier: null,
      thumbnailIdentifier: null,
      submissions,
      failures: [],
      indexUpdated: true,
      entitySignature: submissions[0]?.signature ?? null,
      entityConfirmed,
      entityPayload,
    };
  }

  return {
    status: 'index-incomplete',
    message: indexAmbiguous
      ? 'Content published, index update unconfirmed (the index submission timed out). The album is authoritative and can be found by the fallback scan.'
      : `Content published, index update incomplete. ${indexMessage ?? ''}`.trim(),
    kind: 'gallery-album',
    id,
    entityIdentifier,
    mediaIdentifier: null,
    thumbnailIdentifier: null,
    submissions,
    failures: indexFailures,
    indexUpdated: false,
    entitySignature: submissions[0]?.signature ?? null,
    entityConfirmed,
    entityPayload,
  };
}

/**
 * Catalog content hash. It is descriptive metadata for the derived index, so a
 * hash/checksum failure must never abort an authoritative content publication.
 */
async function safeContentHash(deps: GalleryPublishDeps, value: unknown): Promise<string | null> {
  try {
    return deps.checksumFn ? await deps.checksumFn(value) : await defaultContentHash(value);
  } catch {
    return null;
  }
}

async function defaultContentHash(value: unknown): Promise<string | null> {
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

function extensionForMime(mimeType: string): string {
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return 'jpg';
  return 'webp';
}

/* -------------------------------------------------------------------------- */
/* Post-publication verification                                              */
/* -------------------------------------------------------------------------- */

export interface ResourceVerification {
  readonly service: string;
  readonly identifier: string;
  /** `null` means the bounded read could not establish presence. */
  readonly present: boolean | null;
  readonly status: string | null;
  readonly sizeBytes: number | null;
  readonly note: string | null;
}

export interface GalleryVerifyResult {
  readonly entity: ResourceVerification;
  readonly media: ResourceVerification | null;
  readonly thumbnail: ResourceVerification | null;
  /** Strong entity check: the served payload still equals the intended payload. */
  readonly contentMatches: boolean | null;
  readonly summary: 'confirmed' | 'submitted-unconfirmed' | 'missing' | 'unknown';
}

async function verifyResource(
  deps: GalleryPublishDeps,
  service: string,
  name: string,
  identifier: string,
): Promise<ResourceVerification> {
  const lookup = await findExactResource(
    deps.reader,
    { service, name, identifier },
    { requestOptions: { timeoutMs: 15_000 } },
  );
  if (lookup.kind === 'error') {
    return {
      service,
      identifier,
      present: null,
      status: null,
      sizeBytes: null,
      note: lookup.error.message,
    };
  }
  if (lookup.kind === 'missing') {
    return { service, identifier, present: false, status: null, sizeBytes: null, note: null };
  }
  return {
    service,
    identifier,
    present: true,
    status: lookup.hit.status,
    sizeBytes: lookup.hit.size,
    note: null,
  };
}

/**
 * Bounded post-publication verification. Never issues a write and never requires
 * every resource to reach `READY`; the exact entity payload is compared when the
 * intended payload is supplied, which is stronger than a status check.
 */
export async function verifyGalleryPublication(
  reference: {
    readonly kind: 'gallery-item' | 'gallery-album';
    readonly id: string;
    readonly publisherName: string;
    readonly expectedEntityPayload?: unknown;
  },
  deps: GalleryPublishDeps = createGalleryPublishDeps(),
): Promise<GalleryVerifyResult> {
  const entityIdentifier = buildEntityIdentifier(reference.kind, reference.id);
  const entity = await verifyResource(deps, 'DOCUMENT', reference.publisherName, entityIdentifier);

  const media =
    reference.kind === 'gallery-item'
      ? await verifyResource(
          deps,
          'IMAGE',
          reference.publisherName,
          buildGalleryMediaIdentifier(reference.id),
        )
      : null;
  const thumbnail =
    reference.kind === 'gallery-item'
      ? await verifyResource(
          deps,
          'THUMBNAIL',
          reference.publisherName,
          buildGalleryThumbnailIdentifier(reference.id),
        )
      : null;

  let contentMatches: boolean | null = null;
  if (entity.present && reference.expectedEntityPayload !== undefined) {
    try {
      const text = await deps.reader.fetchText(
        { service: 'DOCUMENT', name: reference.publisherName, identifier: entityIdentifier },
        { timeoutMs: 15_000 },
      );
      const parsed = parseJsonPayload(text, LIMITS.entityBytes);
      if (parsed.ok) {
        const validated = validateEntityPayload(parsed.value, { expectedKind: reference.kind });
        contentMatches =
          validated.ok &&
          JSON.stringify(validated.value.data) ===
            JSON.stringify(
              (reference.expectedEntityPayload as { data?: unknown } | null)?.data ?? null,
            );
      } else {
        contentMatches = false;
      }
    } catch {
      contentMatches = null;
    }
  }

  const knownPresent = [entity, media, thumbnail].filter(Boolean) as ResourceVerification[];
  const allPresent = knownPresent.every((resource) => resource.present === true);
  const anyUnknown = knownPresent.some((resource) => resource.present === null);

  let summary: GalleryVerifyResult['summary'];
  if (allPresent) summary = contentMatches === true ? 'confirmed' : 'submitted-unconfirmed';
  else if (anyUnknown) summary = 'unknown';
  else summary = 'missing';

  return { entity, media, thumbnail, contentMatches, summary };
}
