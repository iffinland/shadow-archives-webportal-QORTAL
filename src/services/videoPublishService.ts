/**
 * Shadow Archives owner Video publication (Video vertical).
 *
 * This is the only module that turns a Video draft into QDN writes. It owns:
 * fresh authority re-verification immediately before every write, the staged
 * publish order (media+poster → canonical entity + interoperability metadata →
 * derived index), truthful partial/timeout reporting, bounded readback
 * verification and cache invalidation. It never retries an ambiguous write.
 *
 * It is imported only from the lazy Videos-owner boundary: public visitors and
 * the startup graph never load it, `qortal/publish`, the poster pipeline or the
 * Q-Tube adapter.
 *
 * Published QDN resource model for one video (canonical id `<id12>`):
 *   - `saw_vid_<id>`              DOCUMENT   Shadow Archives entity (authoritative)
 *   - `saw_vid_thumb_<id>`        THUMBNAIL  poster
 *   - `qtube_vid_<id>`            VIDEO      the media bytes, published ONCE
 *   - `qtube_vid_<id>_metadata`   DOCUMENT   Q-Tube-compatible metadata (derived)
 *   - `saw_cat_vid_p###` + `saw_cat_manifest` DOCUMENT  derived catalog
 *
 * The media resource lives in the shared Q-Tube video family on purpose: the
 * ecosystem treats a video's media identifier as its metadata identifier minus
 * `_metadata` (`Qortal/Subwire` `src/utils/articleQdn.ts` does exactly that), and
 * the Q-Tube metadata's `videoReference` points at the same single resource. No
 * media bytes are published twice. See `services/qtubeVideoContract.ts` for the
 * verified contract and revisions; the Shadow Archives entity/catalog remain the
 * canonical, app-owned model and Shadow Archives discovery never depends on
 * Q-Tube.
 *
 * Write transport: the poster/entity/metadata payloads are sent as base64
 * (`data64`), while the video bytes are sent as a `file` so the host — not this
 * app — performs the base64 conversion (verified Hub behaviour; see
 * `qortal/publish.ts`).
 */

import { LIMITS } from '../domain/constants';
import { validateEntityPayload } from '../domain/entities';
import {
  buildEntityIdentifier,
  buildVideoThumbnailIdentifier,
  generateUniqueStableId,
  type RandomBytes,
} from '../domain/identifiers';
import { normalizeTaxonomySlug } from '../domain/taxonomy';
import type { VideoEntry } from '../domain/types';
import {
  checkVideoSourceSize,
  checkVideoSourceType,
  VIDEO_MEDIA_POLICY,
} from '../domain/videoMedia';
import {
  bridgePublishPort,
  type PublishAttempt,
  type PublishFailure,
  type PublishPort,
  type PublishSubmission,
} from '../qortal/publish';
import { utf8ToBase64 } from './base64';
import { getContentCache, type ContentCache } from './cache';
import { catalogEntryFromVideoEntry } from './catalogWriter';
import {
  catalogIdIsTaken,
  planCatalogEntry,
  readCatalogContext,
  safeContentHashOf,
  type CatalogWriteContext,
} from './catalogPublishSupport';
import { invalidateCatalogCache } from './catalogRepository';
import { invalidateEntityCache } from './contentRepository';
import { findExactResource } from './identity';
import {
  browserImageProcessingDeps,
  ImageProcessingError,
  processPosterImage,
  type ImageProcessingDeps,
  type PosterImageResult,
} from './imageProcessing';
import { authorityFailure, authorityFreshFailure, type OwnerWriteContext } from './ownerAuthority';

// Re-exported so the lazy Videos-owner modal imports one module (mirrors the
// Gallery publish service's surface).
export type { OwnerWriteContext } from './ownerAuthority';
import { bridgeQdnReadPort, parseJsonPayload, type QdnReadPort } from './qdnReader';
import {
  buildQtubeVideoMetadata,
  isValidQtubeVideoMetadata,
  parseQtubeMetadataIdentifier,
  QTUBE_CORE_TITLE_MAX,
  QTUBE_METADATA_PAYLOAD_CAP_BYTES,
  qtubeCategoryIdFor,
  qtubeCoreMetadataDescription,
  qtubeMetadataIdentifier,
  qtubeVideoIdentifier,
  QTUBE_VIDEO_DISCOVERY_REQUEST,
  QTUBE_VIDEO_IDENTIFIER_BASE,
  type QtubeVideoMetadata,
} from './qtubeVideoContract';

/* -------------------------------------------------------------------------- */
/* Input, context and result types                                            */
/* -------------------------------------------------------------------------- */

export interface VideoPublishDraft {
  /** The media bytes. Sent to the host as a `file`, never base64-encoded here. */
  readonly video: File;
  /** The required poster image; published as `THUMBNAIL` and embedded for Q-Tube. */
  readonly poster: File;
  readonly title: string;
  readonly description: string;
  readonly categories: readonly string[];
  readonly tags: readonly string[];
  readonly language: string;
  /** Duration reported by the owner's browser probe. */
  readonly durationSeconds: number;
  /**
   * Retained across retries so resubmitting the same draft reuses the same
   * identity (and therefore the same QDN coordinates) instead of creating a
   * second video.
   */
  readonly id?: string;
}

export type VideoPublishStep =
  | 'preparing-media'
  | 'checking-authority'
  | 'awaiting-approval'
  | 'publishing-media'
  | 'publishing-metadata'
  | 'updating-index'
  | 'confirming';

export interface VideoPublishProgress {
  readonly step: VideoPublishStep;
  readonly label: string;
  readonly detail?: string;
  /** 1-based position and total for the concrete plan being executed. */
  readonly index: number;
  readonly total: number;
}

export type VideoPublicationStatus =
  'published' | 'index-incomplete' | 'partial' | 'ambiguous' | 'failed';

/** Exact QDN coordinates of one publication attempt; enables verification/recovery. */
export interface VideoResourceIdentities {
  readonly entityIdentifier: string;
  readonly videoIdentifier: string;
  readonly metadataIdentifier: string;
  readonly thumbnailIdentifier: string;
}

export interface VideoPublicationResult extends VideoResourceIdentities {
  /** Owner-facing truthful summary; never claims more than the evidence supports. */
  readonly status: VideoPublicationStatus;
  readonly message: string;
  readonly id: string;
  readonly publisherName: string;
  readonly submissions: readonly PublishSubmission[];
  readonly failures: readonly PublishFailure[];
  readonly indexUpdated: boolean;
  /** Submission signature of the authoritative entity resource, when returned. */
  readonly entitySignature: string | null;
  /** True when the entity was confirmed present by a bounded read after submission. */
  readonly entityConfirmed: boolean;
  /** The exact entity payload written; enables strong readback verification. */
  readonly entityPayload: unknown;
  /** The exact Q-Tube-interoperable metadata payload written. */
  readonly metadataPayload: QtubeVideoMetadata;
}

export type VideoPublishErrorCode =
  | 'not-hosted'
  | 'not-owner'
  | 'authority-unresolved'
  | 'authority-changed'
  | 'invalid-input'
  | 'poster-processing'
  | 'id-generation-failed'
  | 'payload-too-large'
  | 'unexpected';

export class VideoPublishError extends Error {
  readonly code: VideoPublishErrorCode;

  constructor(code: VideoPublishErrorCode, message: string) {
    super(message);
    this.name = 'VideoPublishError';
    this.code = code;
  }
}

export interface VideoPublishDeps {
  readonly reader: QdnReadPort;
  readonly writer: PublishPort;
  readonly cache: ContentCache;
  readonly now: () => number;
  readonly random?: RandomBytes;
  readonly checksumFn?: (value: unknown) => Promise<string | null>;
  readonly imageDeps?: ImageProcessingDeps;
  readonly delay?: (ms: number) => Promise<void>;
}

/** Default dependencies: the injected bridge for reads/writes and the shared cache. */
export function createVideoPublishDeps(
  overrides: Partial<VideoPublishDeps> = {},
): VideoPublishDeps {
  return {
    reader: overrides.reader ?? bridgeQdnReadPort,
    writer: overrides.writer ?? bridgePublishPort,
    cache: overrides.cache ?? getContentCache(),
    now: overrides.now ?? (() => Date.now()),
    random: overrides.random,
    checksumFn: overrides.checksumFn,
    imageDeps: overrides.imageDeps ?? browserImageProcessingDeps,
    delay: overrides.delay,
  };
}

export interface PublishVideoOptions {
  readonly onProgress?: (progress: VideoPublishProgress) => void;
  /** Receives the encoded poster once, for the modal's preparation summary. */
  readonly onPosterPrepared?: (poster: PosterImageResult) => void;
}

/* -------------------------------------------------------------------------- */
/* Payload helpers                                                            */
/* -------------------------------------------------------------------------- */

const CORE_METADATA_DESCRIPTION_MAX = 240;

function authorityCheck(ctx: OwnerWriteContext, publisherName: string): void {
  const failure = authorityFailure(ctx, publisherName, 'Video');
  if (failure) throw new VideoPublishError(failure.code, failure.message);
}

async function documentData64(payload: unknown, capBytes: number): Promise<string> {
  const text = JSON.stringify(payload);
  const byteLength = new TextEncoder().encode(text).length;
  if (byteLength > capBytes) {
    throw new VideoPublishError(
      'payload-too-large',
      `The generated payload is ${byteLength} bytes, above the ${capBytes}-byte app limit.`,
    );
  }
  return utf8ToBase64(text);
}

/**
 * Safe single-segment file name for QDN. Q-Tube's `filename` is part of its
 * discovery validity gate, so it must always be non-empty.
 */
export function sanitizeVideoFileName(fileName: string, id: string): string {
  const base = fileName.trim().split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^[._]+/, '');
  if (cleaned.length > 0 && cleaned.length <= 128) return cleaned;
  const extension = /\.([A-Za-z0-9]{1,5})$/.exec(base)?.[1]?.toLowerCase() ?? 'mp4';
  return `saw-video-${id}.${extension}`;
}

/** Video slugs are required by the entity validator and must be non-empty. */
export function videoSlugFromTitle(title: string, id: string): string {
  const slug = normalizeTaxonomySlug(title);
  if (slug && slug.length > 0) return slug.slice(0, LIMITS.slug);
  return `video-${id}`.slice(0, LIMITS.slug);
}

/* -------------------------------------------------------------------------- */
/* Progress + stages                                                          */
/* -------------------------------------------------------------------------- */

interface ProgressEmitter {
  (step: VideoPublishStep, label: string, detail?: string): void;
}

function createProgressEmitter(
  onProgress: ((progress: VideoPublishProgress) => void) | undefined,
  total: number,
): ProgressEmitter {
  let index = 0;
  return (step, label, detail) => {
    index = Math.min(index + 1, total);
    onProgress?.({ step, label, detail, index, total });
  };
}

interface StageOutcome {
  readonly ok: boolean;
  readonly attempt: PublishAttempt | null;
  readonly failureMessage: string | null;
}

function stageLabel(step: string): string {
  switch (step) {
    case 'publishing-media':
      return 'Publishing video and poster';
    case 'publishing-metadata':
      return 'Publishing video metadata and Q-Tube interoperability resource';
    case 'updating-index':
      return 'Updating the Videos index';
    default:
      return 'Publishing';
  }
}

async function runStage(
  ctx: OwnerWriteContext,
  deps: VideoPublishDeps,
  publisherName: string,
  step: 'publishing-media' | 'publishing-metadata' | 'updating-index',
  resources: readonly Record<string, unknown>[],
  emit: ProgressEmitter,
): Promise<StageOutcome> {
  emit('checking-authority', 'Checking owner authority');
  const failure = await authorityFreshFailure(ctx, publisherName, 'Video');
  if (failure) throw new VideoPublishError(failure.code, failure.message);

  emit(
    'awaiting-approval',
    'Awaiting Qortal approval',
    'The Qortal host will ask you to approve the resource fee for this step.',
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

function attemptStatus(attempt: PublishAttempt | null): VideoPublicationStatus {
  if (!attempt) return 'failed';
  if (attempt.kind === 'ambiguous') return 'ambiguous';
  if (attempt.kind === 'partial') return 'partial';
  return 'failed';
}

function submissionsOf(attempt: PublishAttempt | null): PublishSubmission[] {
  if (!attempt) return [];
  if (attempt.kind === 'submitted' || attempt.kind === 'partial') return [...attempt.submissions];
  return [];
}

function failuresOf(attempt: PublishAttempt | null): PublishFailure[] {
  if (!attempt) return [];
  if (attempt.kind === 'partial' || attempt.kind === 'failed') return [...attempt.failures];
  return [];
}

function failResult(
  id: string,
  publisherName: string,
  identities: VideoResourceIdentities,
  status: VideoPublicationStatus,
  message: string,
  submissions: readonly PublishSubmission[],
  failures: readonly PublishFailure[],
  entityPayload: unknown,
  metadataPayload: QtubeVideoMetadata,
): VideoPublicationResult {
  return {
    status,
    message,
    id,
    publisherName,
    ...identities,
    submissions,
    failures,
    indexUpdated: false,
    entitySignature: null,
    entityConfirmed: false,
    entityPayload,
    metadataPayload,
  };
}

async function confirmEntity(
  deps: VideoPublishDeps,
  identity: { service: string; name: string; identifier: string },
  emit: ProgressEmitter,
): Promise<boolean> {
  emit('confirming', 'Confirming the published video');
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
  deps: VideoPublishDeps,
  publisherName: string,
  entityIdentifier: string,
  catalog: CatalogWriteContext,
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
/* Publication                                                                */
/* -------------------------------------------------------------------------- */

export async function publishVideo(
  ctx: OwnerWriteContext,
  draft: VideoPublishDraft,
  options: PublishVideoOptions = {},
  deps: VideoPublishDeps = createVideoPublishDeps(),
): Promise<VideoPublicationResult> {
  const publisherName = ctx.environment.publisherName;
  if (!publisherName) {
    throw new VideoPublishError('authority-unresolved', 'No publishing name is available.');
  }
  if (!draft.title.trim()) {
    throw new VideoPublishError('invalid-input', 'A title is required.');
  }
  if (draft.title.trim().length > LIMITS.title) {
    throw new VideoPublishError(
      'invalid-input',
      `The title must be at most ${LIMITS.title} characters.`,
    );
  }
  if (draft.description.trim().length > LIMITS.description) {
    throw new VideoPublishError(
      'invalid-input',
      `The description must be at most ${LIMITS.description} characters.`,
    );
  }
  if (!draft.language.trim()) {
    throw new VideoPublishError('invalid-input', 'A language code is required.');
  }
  if (!Number.isFinite(draft.durationSeconds) || draft.durationSeconds <= 0) {
    throw new VideoPublishError('invalid-input', 'A positive video duration is required.');
  }
  // The modal validates too, but the service never trusts the caller: a write
  // path must fail closed on an out-of-policy file.
  const sizeCheck = checkVideoSourceSize(draft.video.size, draft.video.name);
  if (!sizeCheck.ok)
    throw new VideoPublishError('invalid-input', sizeCheck.message ?? 'Invalid video.');
  const typeCheck = checkVideoSourceType(draft.video.type);
  if (!typeCheck.ok)
    throw new VideoPublishError('invalid-input', typeCheck.message ?? 'Invalid video.');

  // Pre-write authority gate: nothing (including poster encoding) starts until
  // the session is a verified owner in a real host.
  authorityCheck(ctx, publisherName);

  // Read the derived index before any write so an unreadable catalog cannot
  // block the authoritative content write and the counter can be truthful.
  const catalogBase = await readCatalogContext(deps, publisherName, 'Video');
  const emit = createProgressEmitter(options.onProgress, catalogBase.skipReason ? 8 : 11);

  emit('preparing-media', 'Preparing the poster image');
  let poster: PosterImageResult;
  try {
    poster = await processPosterImage(draft.poster, VIDEO_MEDIA_POLICY.thumbnail, deps.imageDeps);
  } catch (error) {
    if (error instanceof ImageProcessingError) {
      throw new VideoPublishError('poster-processing', error.message);
    }
    throw new VideoPublishError('poster-processing', 'The poster image could not be prepared.');
  }
  options.onPosterPrepared?.(poster);

  const now = deps.now();
  const taken = async (id: string): Promise<boolean> =>
    catalogIdIsTaken(deps, publisherName, 'video', id, new Set<string>());
  let id: string;
  if (draft.id) {
    id = draft.id;
  } else {
    try {
      id = await generateUniqueStableId(taken, { random: deps.random });
    } catch {
      throw new VideoPublishError(
        'id-generation-failed',
        'A unique video id could not be generated.',
      );
    }
  }

  const identities: VideoResourceIdentities = {
    entityIdentifier: buildEntityIdentifier('video', id),
    videoIdentifier: qtubeVideoIdentifier(id),
    metadataIdentifier: qtubeMetadataIdentifier(id),
    thumbnailIdentifier: buildVideoThumbnailIdentifier(id),
  };

  const entityData = {
    title: draft.title.trim(),
    slug: videoSlugFromTitle(draft.title, id),
    description: draft.description.trim(),
    media: {
      service: 'VIDEO',
      name: publisherName,
      identifier: identities.videoIdentifier,
      mimeType: draft.video.type || 'video/mp4',
    },
    externalMedia: null,
    thumbnail: {
      service: 'THUMBNAIL',
      name: publisherName,
      identifier: identities.thumbnailIdentifier,
      mimeType: poster.mimeType,
    },
    durationSeconds: draft.durationSeconds,
    categories: [...draft.categories],
    tags: [...draft.tags],
    language: draft.language.trim(),
  };

  const entityPayload = {
    schemaVersion: 1,
    kind: 'video' as const,
    id,
    publisher: publisherName,
    createdAt: now,
    updatedAt: now,
    state: 'active' as const,
    data: entityData,
  };

  const validated = validateEntityPayload(entityPayload, { expectedKind: 'video' });
  if (!validated.ok) {
    throw new VideoPublishError(
      'invalid-input',
      `The video entity is invalid: ${validated.message}`,
    );
  }
  const entity = validated.value as VideoEntry;

  const fileName = sanitizeVideoFileName(draft.video.name, id);
  const videoType = draft.video.type || 'video/mp4';
  const code = id.slice(0, 5);
  const categoryId = qtubeCategoryIdFor([...draft.categories, ...draft.tags]);
  const qtubeDescription = qtubeCoreMetadataDescription({
    categoryId,
    code,
    description: entity.data.description || entity.data.title,
  });

  const metadataPayload = buildQtubeVideoMetadata({
    title: entity.data.title,
    description: entity.data.description,
    htmlDescription: null,
    thumbnailDataUrl: poster.dataUrl,
    media: {
      name: publisherName,
      identifier: identities.videoIdentifier,
      service: 'VIDEO',
    },
    categoryId,
    code,
    videoType,
    filename: fileName,
    fileSize: draft.video.size,
    durationSeconds: draft.durationSeconds,
  });

  if (!isValidQtubeVideoMetadata(metadataPayload)) {
    // A fail-closed self-check: never publish an interoperability artifact that
    // Q-Tube's own validity gate would reject.
    throw new VideoPublishError(
      'invalid-input',
      'The Q-Tube-compatible metadata failed its own validity check and was not published.',
    );
  }

  // Plan the derived index before any write so an unreadable catalog cannot
  // block the authoritative content write.
  const contentHash = await safeContentHashOf(entity.data, deps.checksumFn);
  const catalog = await planCatalogEntry(
    deps,
    publisherName,
    'Video',
    'video',
    catalogEntryFromVideoEntry(entity, contentHash),
    catalogBase,
  );

  const videoResource: Record<string, unknown> = {
    service: 'VIDEO',
    name: publisherName,
    identifier: identities.videoIdentifier,
    file: draft.video,
    filename: fileName,
    title: entity.data.title.slice(0, QTUBE_CORE_TITLE_MAX),
    description: qtubeDescription.slice(0, CORE_METADATA_DESCRIPTION_MAX),
    tags: [QTUBE_VIDEO_IDENTIFIER_BASE],
  };

  const thumbnailResource: Record<string, unknown> = {
    service: 'THUMBNAIL',
    name: publisherName,
    identifier: identities.thumbnailIdentifier,
    data64: await utf8OrBlobBase64(poster),
    filename: `saw-vid-${id}-poster.${poster.mimeType === 'image/png' ? 'png' : 'webp'}`,
  };

  const entityResource: Record<string, unknown> = {
    service: 'DOCUMENT',
    name: publisherName,
    identifier: identities.entityIdentifier,
    data64: await documentData64(entityPayload, LIMITS.entityBytes),
    filename: `${identities.entityIdentifier}.json`,
    title: entity.data.title.slice(0, 80),
    description: entity.data.description.slice(0, 200),
    tags: entity.data.tags.slice(0, 5).filter((tag) => tag.length <= 20),
  };

  const metadataResource: Record<string, unknown> = {
    service: 'DOCUMENT',
    name: publisherName,
    identifier: identities.metadataIdentifier,
    data64: await documentData64(metadataPayload, QTUBE_METADATA_PAYLOAD_CAP_BYTES),
    filename: 'video_metadata.json',
    title: entity.data.title.slice(0, QTUBE_CORE_TITLE_MAX),
    description: qtubeDescription.slice(0, CORE_METADATA_DESCRIPTION_MAX),
    tags: [QTUBE_VIDEO_IDENTIFIER_BASE],
  };

  const catalogResources: Record<string, unknown>[] = [];
  if (catalog.plan) {
    catalogResources.push(
      {
        service: 'DOCUMENT',
        name: publisherName,
        identifier: catalog.plan.partitionIdentifier,
        data64: await documentData64(catalog.plan.partition, LIMITS.catalogBytes),
        filename: `${catalog.plan.partitionIdentifier}.json`,
        title: 'Shadow Archives catalog partition',
      },
      {
        service: 'DOCUMENT',
        name: publisherName,
        identifier: catalog.plan.manifestIdentifier,
        data64: await documentData64(catalog.plan.manifest, LIMITS.catalogBytes),
        filename: `${catalog.plan.manifestIdentifier}.json`,
        title: 'Shadow Archives catalog manifest',
      },
    );
  }

  // Stage 1: media + poster. The entity must not be written unless the bytes it
  // references exist.
  const mediaStage = await runStage(
    ctx,
    deps,
    publisherName,
    'publishing-media',
    [videoResource, thumbnailResource],
    emit,
  );
  if (!mediaStage.ok || !mediaStage.attempt) {
    await invalidateAfterPublish(deps, publisherName, identities.entityIdentifier, catalog);
    return failResult(
      id,
      publisherName,
      identities,
      attemptStatus(mediaStage.attempt),
      mediaStage.failureMessage ?? 'The video and poster were not published.',
      submissionsOf(mediaStage.attempt),
      failuresOf(mediaStage.attempt),
      entityPayload,
      metadataPayload,
    );
  }

  // Stage 2: the authoritative entity + the Q-Tube interoperability artifact.
  // Grouped so the owner approves one metadata step; the host still reports
  // per-resource outcomes, so a partial result stays truthful.
  const metadataStage = await runStage(
    ctx,
    deps,
    publisherName,
    'publishing-metadata',
    [entityResource, metadataResource],
    emit,
  );
  if (!metadataStage.ok || !metadataStage.attempt) {
    await invalidateAfterPublish(deps, publisherName, identities.entityIdentifier, catalog);
    const ambiguous = metadataStage.attempt?.kind === 'ambiguous';
    const partial = metadataStage.attempt?.kind === 'partial';
    return failResult(
      id,
      publisherName,
      identities,
      attemptStatus(metadataStage.attempt),
      ambiguous
        ? 'The metadata submission timed out. The video may have been published; verify before retrying.'
        : partial
          ? `${metadataStage.failureMessage ?? 'Some metadata was not published.'} The video file is published and nothing was retried automatically. Check the failures above, then re-publish the same draft to retry — the same identity is reused, so no duplicate video is created.`
          : (metadataStage.failureMessage ?? 'The video metadata was not published.'),
      submissionsOf(mediaStage.attempt).concat(submissionsOf(metadataStage.attempt)),
      failuresOf(metadataStage.attempt),
      entityPayload,
      metadataPayload,
    );
  }

  const metadataSubmissions = submissionsOf(metadataStage.attempt);
  const entitySignature =
    metadataSubmissions.find(
      (submission: PublishSubmission) =>
        submission.service === 'DOCUMENT' && submission.identifier === identities.entityIdentifier,
    )?.signature ?? null;
  const entityConfirmed = await confirmEntity(
    deps,
    { service: 'DOCUMENT', name: publisherName, identifier: identities.entityIdentifier },
    emit,
  );

  // Stage 3: derived index (partition + manifest).
  let indexUpdated = false;
  let indexFailure: readonly PublishFailure[] = [];
  let indexAmbiguous = false;
  let indexMessage: string | null = catalog.skipReason;

  if (catalogResources.length > 0) {
    const indexStage = await runStage(
      ctx,
      deps,
      publisherName,
      'updating-index',
      catalogResources,
      emit,
    );
    if (indexStage.ok) {
      indexUpdated = true;
    } else {
      if (indexStage.attempt?.kind === 'partial') indexFailure = indexStage.attempt.failures;
      if (indexStage.attempt?.kind === 'ambiguous') indexAmbiguous = true;
      indexMessage = indexStage.failureMessage ?? 'The Videos index could not be updated.';
    }
  }

  await invalidateAfterPublish(deps, publisherName, identities.entityIdentifier, catalog);

  const submissions = submissionsOf(mediaStage.attempt).concat(metadataSubmissions);

  // A partial or failed metadata stage already returned above (runStage reports it
  // as `ok: false`), so reaching this point means both metadata resources were
  // submitted; only the derived-index outcome can still be incomplete.
  if (indexUpdated) {
    return {
      status: 'published',
      message: entityConfirmed
        ? 'Published. The video, its poster, its metadata and the Q-Tube-compatible resource are available.'
        : 'Published. The submission was acknowledged; availability is still being confirmed.',
      id,
      publisherName,
      ...identities,
      submissions,
      failures: [],
      indexUpdated: true,
      entitySignature,
      entityConfirmed,
      entityPayload,
      metadataPayload,
    };
  }

  return {
    status: 'index-incomplete',
    message: indexAmbiguous
      ? 'Content published, index update unconfirmed (the index submission timed out). The video entity is authoritative and is found by the bounded discovery scan.'
      : `Content published, index update incomplete. ${indexMessage ?? ''}`.trim(),
    id,
    publisherName,
    ...identities,
    submissions,
    failures: indexFailure,
    indexUpdated: false,
    entitySignature,
    entityConfirmed,
    entityPayload,
    metadataPayload,
  };
}

/** Poster bytes are already base64'd, so only the resource body needs encoding. */
async function utf8OrBlobBase64(poster: PosterImageResult): Promise<string> {
  const marker = `;base64,`;
  const index = poster.dataUrl.indexOf(marker);
  if (index < 0) {
    throw new VideoPublishError('poster-processing', 'The prepared poster could not be encoded.');
  }
  return poster.dataUrl.slice(index + marker.length);
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

export interface QtubeDiscoveryVerification {
  /** True when the publication appeared in Q-Tube's own discovery query shape. */
  readonly found: boolean | null;
  readonly hits: number;
  readonly note: string | null;
}

export interface VideoVerifyResult extends VideoResourceIdentities {
  readonly entity: ResourceVerification;
  readonly video: ResourceVerification;
  readonly thumbnail: ResourceVerification;
  readonly metadata: ResourceVerification;
  /** Strong entity check: the served payload still equals the intended payload. */
  readonly contentMatches: boolean | null;
  /** The served Q-Tube artifact passes Q-Tube's own validity gate. */
  readonly qtubeMetadataValid: boolean | null;
  /** The served artifact's `videoReference` points at this publication's media. */
  readonly qtubeReferenceMatches: boolean | null;
  /** Read-only evidence that Q-Tube's discovery query finds this publication. */
  readonly qtubeDiscovery: QtubeDiscoveryVerification;
  readonly summary: 'confirmed' | 'submitted-unconfirmed' | 'missing' | 'unknown';
}

async function verifyResource(
  deps: VideoPublishDeps,
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
 * intended payload is supplied, and the Q-Tube artifact is checked against
 * Q-Tube's own validity gate plus the exact discovery query Q-Tube issues.
 */
export async function verifyVideoPublication(
  reference: {
    readonly id: string;
    readonly publisherName: string;
    readonly expectedEntityPayload?: unknown;
  },
  deps: VideoPublishDeps = createVideoPublishDeps(),
): Promise<VideoVerifyResult> {
  const identities: VideoResourceIdentities = {
    entityIdentifier: buildEntityIdentifier('video', reference.id),
    videoIdentifier: qtubeVideoIdentifier(reference.id),
    metadataIdentifier: qtubeMetadataIdentifier(reference.id),
    thumbnailIdentifier: buildVideoThumbnailIdentifier(reference.id),
  };
  const name = reference.publisherName;

  const entity = await verifyResource(deps, 'DOCUMENT', name, identities.entityIdentifier);
  const video = await verifyResource(deps, 'VIDEO', name, identities.videoIdentifier);
  const thumbnail = await verifyResource(deps, 'THUMBNAIL', name, identities.thumbnailIdentifier);
  const metadata = await verifyResource(deps, 'DOCUMENT', name, identities.metadataIdentifier);

  let contentMatches: boolean | null = null;
  if (entity.present && reference.expectedEntityPayload !== undefined) {
    try {
      const text = await deps.reader.fetchText(
        { service: 'DOCUMENT', name, identifier: identities.entityIdentifier },
        { timeoutMs: 15_000 },
      );
      const parsed = parseJsonPayload(text, LIMITS.entityBytes);
      if (parsed.ok) {
        const validated = validateEntityPayload(parsed.value, { expectedKind: 'video' });
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

  let qtubeMetadataValid: boolean | null = null;
  let qtubeReferenceMatches: boolean | null = null;
  if (metadata.present) {
    try {
      const text = await deps.reader.fetchText(
        { service: 'DOCUMENT', name, identifier: identities.metadataIdentifier },
        { timeoutMs: 15_000 },
      );
      const parsed = parseJsonPayload(text, QTUBE_METADATA_PAYLOAD_CAP_BYTES);
      if (parsed.ok) {
        qtubeMetadataValid = isValidQtubeVideoMetadata(parsed.value);
        const served = parsed.value as Partial<QtubeVideoMetadata> | null;
        const videoReference = served?.videoReference;
        qtubeReferenceMatches =
          qtubeMetadataValid &&
          videoReference?.service === 'VIDEO' &&
          videoReference?.name?.toLowerCase() === name.toLowerCase() &&
          videoReference?.identifier === identities.videoIdentifier;
      } else {
        qtubeMetadataValid = false;
        qtubeReferenceMatches = false;
      }
    } catch {
      qtubeMetadataValid = null;
      qtubeReferenceMatches = null;
    }
  }

  const qtubeDiscovery = await verifyQtubeDiscovery(deps, name, identities.metadataIdentifier);

  const present = [entity, video, thumbnail, metadata];
  const allPresent = present.every((resource) => resource.present === true);
  const anyUnknown = present.some((resource) => resource.present === null);

  let summary: VideoVerifyResult['summary'];
  if (allPresent) {
    summary =
      contentMatches === true && qtubeMetadataValid === true && qtubeReferenceMatches === true
        ? 'confirmed'
        : 'submitted-unconfirmed';
  } else if (anyUnknown) {
    summary = 'unknown';
  } else {
    summary = 'missing';
  }

  return {
    ...identities,
    entity,
    video,
    thumbnail,
    metadata,
    contentMatches,
    qtubeMetadataValid,
    qtubeReferenceMatches,
    qtubeDiscovery,
    summary,
  };
}

/**
 * Read-only proof of Q-Tube-side discoverability: run the exact discovery request
 * Q-Tube's Home/Search surface issues (`identifier = 'qtube_vid_'`, DOCUMENT,
 * `mode: 'ALL'`) under the publishing name and check that this publication's
 * metadata identifier is in the result set.
 *
 * One bounded page; a failure is reported as `null`, never fabricated.
 */
async function verifyQtubeDiscovery(
  deps: VideoPublishDeps,
  publisherName: string,
  metadataIdentifier: string,
): Promise<QtubeDiscoveryVerification> {
  try {
    const raw = await deps.reader.search(
      {
        ...QTUBE_VIDEO_DISCOVERY_REQUEST,
        service: QTUBE_VIDEO_DISCOVERY_REQUEST.service,
        identifier: QTUBE_VIDEO_DISCOVERY_REQUEST.identifier,
        mode: 'ALL',
        name: publisherName,
        limit: 50,
        offset: 0,
        reverse: true,
      },
      { timeoutMs: 20_000 },
    );
    let hits = 0;
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      if (record.service !== 'DOCUMENT') continue;
      if (
        typeof record.name !== 'string' ||
        record.name.toLowerCase() !== publisherName.toLowerCase()
      ) {
        continue;
      }
      if (typeof record.identifier !== 'string') continue;
      if (!record.identifier.includes(QTUBE_VIDEO_IDENTIFIER_BASE)) continue;
      hits += 1;
      if (record.identifier === metadataIdentifier) {
        return { found: true, hits, note: null };
      }
    }
    return {
      found: false,
      hits,
      note: `Searched ${raw.length} result(s); this publication's Q-Tube metadata identifier was not among them yet. Node search indexes lag a fresh publication.`,
    };
  } catch (error) {
    return {
      found: null,
      hits: 0,
      note: error instanceof Error ? error.message : 'Q-Tube discovery verification failed.',
    };
  }
}

/** True when an identifier is a Shadow Archives Q-Tube artifact for a video id. */
export function qtubeArtifactVideoId(identifier: unknown): string | null {
  return parseQtubeMetadataIdentifier(identifier);
}
