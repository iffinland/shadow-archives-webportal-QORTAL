/**
 * Shadow Archives owner Blog publication (Blog vertical).
 *
 * This is the only module that turns a Blog draft into QDN writes. It owns fresh
 * authority re-verification immediately before every write, the staged publish
 * order (cover → canonical entity + SubWire artifact → derived index), the
 * optional owner-controlled Quitter announcement, truthful partial/timeout
 * reporting, bounded readback verification and cache invalidation. It never
 * retries an ambiguous write.
 *
 * It is imported only from the lazy Blog-owner boundary: public visitors and the
 * startup graph never load it, `qortal/publish`, the cover pipeline, the SubWire
 * adapter or the Quitter adapter.
 *
 * Published QDN resource model for one blog post (canonical id `<id12>`):
 *   - `saw_post_<id>`            DOCUMENT   Shadow Archives entity (authoritative,
 *                                           canonical `tiptap-json-v1` body)
 *   - `saw_post_thumb_<id>`      THUMBNAIL  cover image
 *   - SubWire article identifier DOCUMENT   derived SubWire-compatible article
 *                                           (Markdown + inline base64 cover)
 *   - `saw_cat_post_p###` + `saw_cat_manifest` DOCUMENT  derived catalog
 *   - Quitter post identifier    DOCUMENT   optional announcement, only after an
 *                                           explicit owner action
 *
 * The canonical entity is authoritative and Shadow Archives discovery never
 * depends on SubWire or Quitter: SubWire's artifact is a derived, rebuildable
 * resource whose coordinate is deterministically recoverable from the Shadow
 * Archives stable id. See `services/subwireArticleContract.ts` and
 * `services/quitterAnnouncementContract.ts` for the verified contracts and
 * revisions.
 */

import { BLOG_COVER_POLICY } from '../domain/blogMedia';
import { LIMITS } from '../domain/constants';
import { validateEntityPayload } from '../domain/entities';
import {
  buildBlogThumbnailIdentifier,
  buildEntityIdentifier,
  generateUniqueStableId,
  type RandomBytes,
} from '../domain/identifiers';
import { normalizeTaxonomySlug } from '../domain/taxonomy';
import { richTextToMarkdown, richTextToPlainText } from '../domain/richTextMarkdown';
import type { BlogPost, RichTextDocument } from '../domain/types';
import {
  bridgePublishPort,
  type PublishAttempt,
  type PublishFailure,
  type PublishPort,
  type PublishSubmission,
} from '../qortal/publish';
import { utf8ToBase64 } from './base64';
import { getContentCache, type ContentCache } from './cache';
import { catalogEntryFromBlogPost } from './catalogWriter';
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
import { bridgeQdnReadPort, parseJsonPayload, type QdnReadPort } from './qdnReader';
import {
  buildQuitterAnnouncementText,
  buildQuitterPost,
  isQuitterRenderablePost,
  parseQuitterPostIdentifier,
  quitterPostIdentifier,
  QUITTER_POST_ENTITY,
  shadowArchivesArticleUrl,
  type QuitterPost,
} from './quitterAnnouncementContract';
import {
  buildSubwireArticle,
  isSubwireRenderableArticle,
  parseSubwireArticleIdentifier,
  subwireArticleIdentifier,
  subwireArticleIdentifierPrefix,
  subwireArticleUrl,
  subwireCoreDescription,
  subwireCoreTitle,
  SUBWIRE_ARTICLE_DISCOVERY_REQUEST,
  SUBWIRE_ARTIFACT_PAYLOAD_CAP_BYTES,
  type SubwireArticle,
} from './subwireArticleContract';

// Re-exported so the lazy Blog-owner modal imports one module (mirrors the
// Gallery/Video publish services' surface).
export type { OwnerWriteContext } from './ownerAuthority';

/* -------------------------------------------------------------------------- */
/* Input, context and result types                                            */
/* -------------------------------------------------------------------------- */

export interface BlogPublishDraft {
  readonly title: string;
  readonly excerpt: string;
  /** Canonical body (owner decision D4: `tiptap-json-v1`). */
  readonly body: RichTextDocument;
  /** Normalized plain text; recomputed by the service, not trusted from the caller. */
  readonly bodyText?: string;
  /** Required cover image; published as `THUMBNAIL` and embedded for SubWire/Quitter. */
  readonly cover: File;
  readonly categories: readonly string[];
  readonly tags: readonly string[];
  readonly language: string;
  /**
   * Retained across retries so resubmitting the same draft reuses the same QDN
   * coordinates (including the derived SubWire/Quitter ones) instead of creating
   * a second post.
   */
  readonly id?: string;
}

export type BlogPublishStep =
  | 'preparing-cover'
  | 'checking-authority'
  | 'awaiting-approval'
  | 'publishing-cover'
  | 'publishing-article'
  | 'updating-index'
  | 'confirming';

export interface BlogPublishProgress {
  readonly step: BlogPublishStep;
  readonly label: string;
  readonly detail?: string;
  readonly index: number;
  readonly total: number;
}

export type BlogPublicationStatus =
  'published' | 'index-incomplete' | 'partial' | 'ambiguous' | 'failed';

/** Exact QDN coordinates of one publication attempt; enables verification/recovery. */
export interface BlogResourceIdentities {
  readonly entityIdentifier: string;
  readonly thumbnailIdentifier: string;
  readonly subwireIdentifier: string;
}

export interface BlogPublicationResult extends BlogResourceIdentities {
  /** Owner-facing truthful summary; never claims more than the evidence supports. */
  readonly status: BlogPublicationStatus;
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
  /** The exact derived SubWire-compatible article payload written. */
  readonly subwirePayload: SubwireArticle;
  /** WebP base64 of the prepared cover, reused by the optional Quitter step. */
  readonly coverBase64: string;
  /** Prefilled, owner-editable announcement text for the optional Quitter step. */
  readonly quitterAnnouncementText: string;
}

export type BlogPublishErrorCode =
  | 'not-hosted'
  | 'not-owner'
  | 'authority-unresolved'
  | 'authority-changed'
  | 'invalid-input'
  | 'cover-processing'
  | 'id-generation-failed'
  | 'payload-too-large'
  | 'unexpected';

export class BlogPublishError extends Error {
  readonly code: BlogPublishErrorCode;

  constructor(code: BlogPublishErrorCode, message: string) {
    super(message);
    this.name = 'BlogPublishError';
    this.code = code;
  }
}

export interface BlogPublishDeps {
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
export function createBlogPublishDeps(overrides: Partial<BlogPublishDeps> = {}): BlogPublishDeps {
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

export interface PublishBlogOptions {
  readonly onProgress?: (progress: BlogPublishProgress) => void;
  /** Receives the encoded cover once, for the modal's preparation summary. */
  readonly onCoverPrepared?: (cover: PosterImageResult) => void;
}

/* -------------------------------------------------------------------------- */
/* Payload helpers                                                            */
/* -------------------------------------------------------------------------- */

const CORE_METADATA_TITLE_MAX = 80;
const CORE_METADATA_DESCRIPTION_MAX = 200;

function authorityCheck(ctx: OwnerWriteContext, publisherName: string): void {
  const failure = authorityFailure(ctx, publisherName, 'Blog');
  if (failure) throw new BlogPublishError(failure.code, failure.message);
}

async function documentData64(
  payload: unknown,
  capBytes: number,
  subject: string,
): Promise<string> {
  const text = JSON.stringify(payload);
  const byteLength = new TextEncoder().encode(text).length;
  if (byteLength > capBytes) {
    throw new BlogPublishError(
      'payload-too-large',
      `The generated ${subject} is ${byteLength} bytes, above the ${capBytes}-byte limit.`,
    );
  }
  return utf8ToBase64(text);
}

/** Blog slugs are required by the entity validator and must be non-empty. */
export function blogSlugFromTitle(title: string, id: string): string {
  const slug = normalizeTaxonomySlug(title);
  if (slug && slug.length > 0) return slug.slice(0, LIMITS.slug);
  return `post-${id}`.slice(0, LIMITS.slug);
}

/** Bare WebP base64 from the prepared cover data URL. */
function coverBase64From(cover: PosterImageResult): string {
  const marker = ';base64,';
  const index = cover.dataUrl.indexOf(marker);
  if (index < 0) {
    throw new BlogPublishError('cover-processing', 'The prepared cover could not be encoded.');
  }
  return cover.dataUrl.slice(index + marker.length);
}

/**
 * Core metadata tags are capped by Core at 5 entries of <= 20 characters.
 * Mirrored exactly like the Gallery/Video write path does.
 */
export function mirrorableCoreTags(tags: readonly string[]): string[] {
  return tags
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0 && tag.length <= 20)
    .slice(0, 5);
}

/* -------------------------------------------------------------------------- */
/* Progress + stages                                                          */
/* -------------------------------------------------------------------------- */

type ProgressEmitter = (step: BlogPublishStep, label: string, detail?: string) => void;

function createProgressEmitter(
  onProgress: ((progress: BlogPublishProgress) => void) | undefined,
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
    case 'publishing-cover':
      return 'Publishing the cover image';
    case 'publishing-article':
      return 'Publishing the article and its SubWire-compatible resource';
    case 'updating-index':
      return 'Updating the Blog index';
    default:
      return 'Publishing';
  }
}

async function runStage(
  ctx: OwnerWriteContext,
  deps: BlogPublishDeps,
  publisherName: string,
  step: 'publishing-cover' | 'publishing-article' | 'updating-index',
  resources: readonly Record<string, unknown>[],
  emit: ProgressEmitter,
): Promise<StageOutcome> {
  emit('checking-authority', 'Checking owner authority');
  const failure = await authorityFreshFailure(ctx, publisherName, 'Blog');
  if (failure) throw new BlogPublishError(failure.code, failure.message);

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
    return { ok: false, attempt, failureMessage: `Some resources were not published (${failed}).` };
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

function attemptStatus(attempt: PublishAttempt | null): BlogPublicationStatus {
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
  identities: BlogResourceIdentities,
  status: BlogPublicationStatus,
  message: string,
  submissions: readonly PublishSubmission[],
  failures: readonly PublishFailure[],
  entityPayload: unknown,
  subwirePayload: SubwireArticle,
  coverBase64: string,
  quitterAnnouncementText: string,
): BlogPublicationResult {
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
    subwirePayload,
    coverBase64,
    quitterAnnouncementText,
  };
}

/** Cache invalidation after a write. A failure here never becomes a publish failure. */
async function invalidateAfterPublish(
  deps: BlogPublishDeps,
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
/* The SubWire-compatible coordinate for a post                               */
/* -------------------------------------------------------------------------- */

/**
 * The derived SubWire coordinate of one Shadow Archives post. Exported so the
 * read path, the modal and verification never re-derive it independently.
 */
export async function blogSubwireIdentifier(id: string): Promise<string> {
  return subwireArticleIdentifier(id);
}

/** True when a SubWire article identifier carries this Shadow Archives post id. */
export async function isSubwireArtifactOf(identifier: unknown, id: string): Promise<boolean> {
  return (await parseSubwireArticleIdentifier(identifier)) === id;
}

/* -------------------------------------------------------------------------- */
/* Publication                                                                */
/* -------------------------------------------------------------------------- */

export async function publishBlogPost(
  ctx: OwnerWriteContext,
  draft: BlogPublishDraft,
  options: PublishBlogOptions = {},
  deps: BlogPublishDeps = createBlogPublishDeps(),
): Promise<BlogPublicationResult> {
  const publisherName = ctx.environment.publisherName;
  if (!publisherName) {
    throw new BlogPublishError('authority-unresolved', 'No publishing name is available.');
  }
  if (!draft.title.trim()) {
    throw new BlogPublishError('invalid-input', 'A title is required.');
  }
  if (draft.title.trim().length > LIMITS.title) {
    throw new BlogPublishError(
      'invalid-input',
      `The title must be at most ${LIMITS.title} characters.`,
    );
  }
  if (draft.excerpt.trim().length > LIMITS.excerpt) {
    throw new BlogPublishError(
      'invalid-input',
      `The excerpt must be at most ${LIMITS.excerpt} characters.`,
    );
  }
  if (!draft.language.trim()) {
    throw new BlogPublishError('invalid-input', 'A language code is required.');
  }
  if (!draft.cover || draft.cover.size === 0) {
    throw new BlogPublishError('invalid-input', 'A cover image is required.');
  }

  // The body is canonical and untrusted until validated: never publish a
  // document the read path would quarantine.
  const markdown = richTextToMarkdown(draft.body);
  const bodyText = richTextToPlainText(draft.body);
  if (markdown.trim().length === 0) {
    throw new BlogPublishError('invalid-input', 'The article body is empty.');
  }

  // Pre-write authority gate: nothing (including cover encoding) starts until
  // the session is a verified owner in a real host.
  authorityCheck(ctx, publisherName);

  // Read the derived index before any write so an unreadable catalog cannot
  // block the authoritative content write and the counter can be truthful.
  const catalogBase = await readCatalogContext(deps, publisherName, 'Blog');
  const emit = createProgressEmitter(options.onProgress, catalogBase.skipReason ? 8 : 11);

  emit('preparing-cover', 'Preparing the cover image');
  let cover: PosterImageResult;
  try {
    cover = await processPosterImage(draft.cover, BLOG_COVER_POLICY, deps.imageDeps);
  } catch (error) {
    if (error instanceof ImageProcessingError) {
      throw new BlogPublishError('cover-processing', error.message);
    }
    throw new BlogPublishError('cover-processing', 'The cover image could not be prepared.');
  }
  // SubWire renders the embedded cover as literally `data:image/webp;base64,<src>`
  // (`ArticleCard.tsx`), and the image pipeline only *warns* when the browser
  // encoded a different type. Publishing non-WebP bytes here would therefore show
  // a broken cover in SubWire, so the publication fails closed instead.
  if (cover.mimeType !== 'image/webp') {
    throw new BlogPublishError(
      'cover-processing',
      `This browser encoded the cover as ${cover.mimeType || 'an unknown type'} instead of WebP, which the SubWire-compatible article requires.`,
    );
  }
  options.onCoverPrepared?.(cover);
  const coverBase64 = coverBase64From(cover);

  const now = deps.now();
  const taken = async (id: string): Promise<boolean> =>
    catalogIdIsTaken(deps, publisherName, 'blog-post', id, new Set<string>());
  let id: string;
  if (draft.id) {
    id = draft.id;
  } else {
    try {
      id = await generateUniqueStableId(taken, { random: deps.random });
    } catch {
      throw new BlogPublishError(
        'id-generation-failed',
        'A unique post id could not be generated.',
      );
    }
  }

  const identities: BlogResourceIdentities = {
    entityIdentifier: buildEntityIdentifier('blog-post', id),
    thumbnailIdentifier: buildBlogThumbnailIdentifier(id),
    subwireIdentifier: await blogSubwireIdentifier(id),
  };

  const entityData = {
    title: draft.title.trim(),
    slug: blogSlugFromTitle(draft.title, id),
    excerpt: draft.excerpt.trim(),
    body: draft.body,
    bodyText,
    thumbnail: {
      service: 'THUMBNAIL',
      name: publisherName,
      identifier: identities.thumbnailIdentifier,
      mimeType: cover.mimeType,
    },
    categories: [...draft.categories],
    tags: [...draft.tags],
    language: draft.language.trim(),
  };

  const entityPayload = {
    schemaVersion: 1,
    kind: 'blog-post' as const,
    id,
    publisher: publisherName,
    createdAt: now,
    updatedAt: now,
    state: 'active' as const,
    data: entityData,
  };

  const validated = validateEntityPayload(entityPayload, { expectedKind: 'blog-post' });
  if (!validated.ok) {
    throw new BlogPublishError(
      'invalid-input',
      `The blog post entity is invalid: ${validated.message}`,
    );
  }
  const entity = validated.value as BlogPost;

  const subwirePayload = buildSubwireArticle({
    title: entity.data.title,
    excerpt: entity.data.excerpt,
    markdown,
    coverBase64,
    coverFileName: `saw-post-${id}-cover.webp`,
    timestamp: now,
    publisherName,
  });

  if (!isSubwireRenderableArticle(subwirePayload)) {
    // Fail-closed self-check: never publish a derived artifact the consumer's own
    // render paths would ignore.
    throw new BlogPublishError(
      'invalid-input',
      'The SubWire-compatible article failed its own validity check and was not published.',
    );
  }

  const contentHash = await safeContentHashOf(entity.data, deps.checksumFn);
  const catalog = await planCatalogEntry(
    deps,
    publisherName,
    'Blog',
    'blog-post',
    catalogEntryFromBlogPost(entity, contentHash),
    catalogBase,
  );

  const coverResource: Record<string, unknown> = {
    service: 'THUMBNAIL',
    name: publisherName,
    identifier: identities.thumbnailIdentifier,
    data64: coverBase64,
    filename: `saw-post-${id}-cover.webp`,
  };

  const entityResource: Record<string, unknown> = {
    service: 'DOCUMENT',
    name: publisherName,
    identifier: identities.entityIdentifier,
    data64: await documentData64(entityPayload, LIMITS.entityBytes, 'blog post entity'),
    filename: `${identities.entityIdentifier}.json`,
    title: entity.data.title.slice(0, CORE_METADATA_TITLE_MAX),
    description: entity.data.excerpt.slice(0, CORE_METADATA_DESCRIPTION_MAX),
    tags: mirrorableCoreTags(entity.data.tags),
  };

  const subwireResource: Record<string, unknown> = {
    service: 'DOCUMENT',
    name: publisherName,
    identifier: identities.subwireIdentifier,
    data64: await documentData64(
      subwirePayload,
      SUBWIRE_ARTIFACT_PAYLOAD_CAP_BYTES,
      'SubWire-compatible article',
    ),
    filename: 'subwire-article.json',
    // SubWire writes these two Core metadata fields itself; mirroring them is
    // what makes its publication search (which matches title/description) work.
    title: subwireCoreTitle(entity.data.title),
    description: subwireCoreDescription(entity.data.excerpt),
  };

  const catalogResources: Record<string, unknown>[] = [];
  if (catalog.plan) {
    catalogResources.push(
      {
        service: 'DOCUMENT',
        name: publisherName,
        identifier: catalog.plan.partitionIdentifier,
        data64: await documentData64(
          catalog.plan.partition,
          LIMITS.catalogBytes,
          'catalog partition',
        ),
        filename: `${catalog.plan.partitionIdentifier}.json`,
        title: 'Shadow Archives catalog partition',
      },
      {
        service: 'DOCUMENT',
        name: publisherName,
        identifier: catalog.plan.manifestIdentifier,
        data64: await documentData64(
          catalog.plan.manifest,
          LIMITS.catalogBytes,
          'catalog manifest',
        ),
        filename: `${catalog.plan.manifestIdentifier}.json`,
        title: 'Shadow Archives catalog manifest',
      },
    );
  }

  const quitterAnnouncementText = buildQuitterAnnouncementText({
    title: entity.data.title,
    excerpt: entity.data.excerpt,
    articleUrl: shadowArchivesArticleUrl(publisherName, id),
    subwireUrl: subwireArticleUrl(publisherName, identities.subwireIdentifier),
  });

  // Stage 1: the cover. The article must not be written unless the image its
  // thumbnail reference points at exists.
  const coverStage = await runStage(
    ctx,
    deps,
    publisherName,
    'publishing-cover',
    [coverResource],
    emit,
  );
  if (!coverStage.ok || !coverStage.attempt) {
    await invalidateAfterPublish(deps, publisherName, identities.entityIdentifier, catalog);
    return failResult(
      id,
      publisherName,
      identities,
      attemptStatus(coverStage.attempt),
      coverStage.failureMessage ?? 'The cover image was not published.',
      submissionsOf(coverStage.attempt),
      failuresOf(coverStage.attempt),
      entityPayload,
      subwirePayload,
      coverBase64,
      quitterAnnouncementText,
    );
  }

  // Stage 2: the authoritative entity + the derived SubWire-compatible artifact.
  // Grouped so the owner approves one article step; the host still reports
  // per-resource outcomes, so a partial result stays truthful.
  const articleStage = await runStage(
    ctx,
    deps,
    publisherName,
    'publishing-article',
    [entityResource, subwireResource],
    emit,
  );
  if (!articleStage.ok || !articleStage.attempt) {
    await invalidateAfterPublish(deps, publisherName, identities.entityIdentifier, catalog);
    const partial = articleStage.attempt?.kind === 'partial';
    return failResult(
      id,
      publisherName,
      identities,
      attemptStatus(articleStage.attempt),
      partial
        ? `${articleStage.failureMessage} The authoritative article entity is the resource that must exist; use Verify to establish what was published before retrying.`
        : (articleStage.failureMessage ?? 'The article was not published.'),
      submissionsOf(coverStage.attempt).concat(submissionsOf(articleStage.attempt)),
      failuresOf(articleStage.attempt),
      entityPayload,
      subwirePayload,
      coverBase64,
      quitterAnnouncementText,
    );
  }

  const articleSubmissions = submissionsOf(articleStage.attempt);
  const entitySubmission = articleSubmissions.find(
    (submission) => submission.identifier === identities.entityIdentifier,
  );
  const entitySignature = entitySubmission?.signature ?? null;

  // Bounded readback of the authoritative entity. A slow node or an unindexed
  // fresh resource must not be reported as a failure, so an inconclusive read
  // stays "submitted" instead of "confirmed".
  emit('confirming', 'Confirming the published article');
  const entityConfirmed = await confirmEntity(
    deps,
    publisherName,
    identities.entityIdentifier,
    entityPayload,
  );

  let indexUpdated = false;
  let indexFailure: readonly PublishFailure[] = [];
  let indexAmbiguous = false;
  let indexMessage: string | null = null;

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
      if (indexStage.attempt?.kind === 'partial' || indexStage.attempt?.kind === 'failed') {
        indexFailure = indexStage.attempt.failures;
      }
      if (indexStage.attempt?.kind === 'ambiguous') indexAmbiguous = true;
      indexMessage = indexStage.failureMessage ?? 'The Blog index could not be updated.';
    }
  } else if (catalog.skipReason) {
    indexMessage = catalog.skipReason;
  }

  await invalidateAfterPublish(deps, publisherName, identities.entityIdentifier, catalog);

  const submissions = submissionsOf(coverStage.attempt).concat(articleSubmissions);

  if (indexUpdated) {
    return {
      status: 'published',
      message: entityConfirmed
        ? 'Published. The article, its cover, the SubWire-compatible resource and the Blog index are available.'
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
      subwirePayload,
      coverBase64,
      quitterAnnouncementText,
    };
  }

  return {
    status: 'index-incomplete',
    message: indexAmbiguous
      ? 'Article published, index update unconfirmed (the index submission timed out). The article entity is authoritative and is found by the bounded discovery scan.'
      : `Article published, index update incomplete. ${indexMessage ?? ''}`.trim(),
    id,
    publisherName,
    ...identities,
    submissions,
    failures: indexFailure,
    indexUpdated: false,
    entitySignature,
    entityConfirmed,
    entityPayload,
    subwirePayload,
    coverBase64,
    quitterAnnouncementText,
  };
}

/** Bounded readback: true only when the served payload equals the intended one. */
async function confirmEntity(
  deps: BlogPublishDeps,
  publisherName: string,
  entityIdentifier: string,
  entityPayload: unknown,
): Promise<boolean> {
  try {
    const text = await deps.reader.fetchText(
      { service: 'DOCUMENT', name: publisherName, identifier: entityIdentifier },
      { timeoutMs: 15_000 },
    );
    const parsed = parseJsonPayload(text, LIMITS.entityBytes);
    if (!parsed.ok) return false;
    const validated = validateEntityPayload(parsed.value, { expectedKind: 'blog-post' });
    if (!validated.ok) return false;
    return JSON.stringify(validated.value) === JSON.stringify(entityPayload);
  } catch {
    return false;
  }
}

/* -------------------------------------------------------------------------- */
/* Optional Quitter announcement                                              */
/* -------------------------------------------------------------------------- */

export type QuitterAnnouncementStatus = 'announced' | 'ambiguous' | 'failed';

export interface QuitterAnnouncementResult {
  readonly status: QuitterAnnouncementStatus;
  readonly message: string;
  readonly identifier: string;
  readonly publisherName: string;
  readonly submissions: readonly PublishSubmission[];
  readonly failures: readonly PublishFailure[];
  readonly postPayload: QuitterPost;
  /** True when a bounded read confirmed the post resource exists. */
  readonly postConfirmed: boolean;
}

/**
 * Publish the optional Quitter announcement.
 *
 * A separate, explicit owner action with its own Qortal approval: it runs only
 * when the owner asks for it *after* the article exists, and its failure never
 * changes the article's outcome. The identifier is deterministic for the post
 * id, so an explicit retry overwrites the same announcement instead of creating
 * a duplicate; an ambiguous submission is never retried automatically.
 */
export async function announceOnQuitter(
  ctx: OwnerWriteContext,
  input: {
    readonly id: string;
    readonly text: string;
    /** WebP base64 cover from the publication result; text-only when null. */
    readonly coverBase64: string | null;
  },
  deps: BlogPublishDeps = createBlogPublishDeps(),
): Promise<QuitterAnnouncementResult> {
  const publisherName = ctx.environment.publisherName;
  if (!publisherName) {
    throw new BlogPublishError('authority-unresolved', 'No publishing name is available.');
  }
  const text = input.text.trim();
  if (text.length === 0) {
    throw new BlogPublishError('invalid-input', 'Announcement text is required.');
  }

  const identifier = await quitterPostIdentifier(input.id);
  const postPayload = buildQuitterPost({
    text,
    name: publisherName,
    timestamp: deps.now(),
    coverBase64: input.coverBase64,
  });
  if (!isQuitterRenderablePost(postPayload)) {
    throw new BlogPublishError(
      'invalid-input',
      'The Quitter announcement failed its own validity check and was not published.',
    );
  }

  const authorityProblem = await authorityFreshFailure(ctx, publisherName, 'Quitter announcement');
  if (authorityProblem) throw new BlogPublishError(authorityProblem.code, authorityProblem.message);

  const resource: Record<string, unknown> = {
    service: 'DOCUMENT',
    name: publisherName,
    identifier,
    data64: await documentData64(postPayload, 512 * 1024, 'Quitter announcement'),
    filename: 'quitter-post.json',
  };

  const typed = [resource] as unknown as Parameters<PublishPort['publishResources']>[0];
  const attempt = await deps.writer.publishResource(typed[0]);
  const submissions = submissionsOf(attempt);
  const failures = failuresOf(attempt);

  if (attempt.kind !== 'submitted') {
    const ambiguous = attempt.kind === 'ambiguous';
    return {
      status: ambiguous ? 'ambiguous' : 'failed',
      message: ambiguous
        ? 'The Quitter announcement submission timed out. The host may still have published it; it is never retried automatically. The article itself is unaffected.'
        : `The Quitter announcement was not published (${failures[0]?.reason ?? 'unknown reason'}). The article itself is unaffected.`,
      identifier,
      publisherName,
      submissions,
      failures,
      postPayload,
      postConfirmed: false,
    };
  }

  const postConfirmed = await confirmQuitterPost(deps, publisherName, identifier, postPayload);
  return {
    status: 'announced',
    message: postConfirmed
      ? 'Announced on Quitter. The post and its cover are available.'
      : 'Quitter announced the submission; availability is still being confirmed.',
    identifier,
    publisherName,
    submissions,
    failures,
    postPayload,
    postConfirmed,
  };
}

async function confirmQuitterPost(
  deps: BlogPublishDeps,
  publisherName: string,
  identifier: string,
  postPayload: QuitterPost,
): Promise<boolean> {
  try {
    const text = await deps.reader.fetchText(
      { service: 'DOCUMENT', name: publisherName, identifier },
      { timeoutMs: 15_000 },
    );
    const parsed = parseJsonPayload(text, 512 * 1024);
    if (!parsed.ok) return false;
    return JSON.stringify(parsed.value) === JSON.stringify(postPayload);
  } catch {
    return false;
  }
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

export interface SubwireDiscoveryVerification {
  /** True when the publication appeared in SubWire's own discovery query shape. */
  readonly found: boolean | null;
  readonly hits: number;
  readonly note: string | null;
}

export interface BlogVerifyResult extends BlogResourceIdentities {
  readonly entity: ResourceVerification;
  readonly thumbnail: ResourceVerification;
  readonly subwire: ResourceVerification;
  /** Strong entity check: the served payload still equals the intended payload. */
  readonly contentMatches: boolean | null;
  /** The served SubWire artifact passes the field gate its render paths need. */
  readonly subwireValid: boolean | null;
  /** The served artifact's cover equals the published cover bytes. */
  readonly subwireCoverMatches: boolean | null;
  /** Read-only evidence that SubWire's discovery query finds this publication. */
  readonly subwireDiscovery: SubwireDiscoveryVerification;
  readonly summary: 'confirmed' | 'submitted-unconfirmed' | 'missing' | 'unknown';
}

async function verifyResource(
  deps: BlogPublishDeps,
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
 * intended payload is supplied, and the derived SubWire artifact is checked with
 * the exact discovery query SubWire issues.
 */
export async function verifyBlogPublication(
  reference: {
    readonly id: string;
    readonly publisherName: string;
    readonly expectedEntityPayload?: unknown;
    readonly expectedSubwireCover?: string | null;
  },
  deps: BlogPublishDeps = createBlogPublishDeps(),
): Promise<BlogVerifyResult> {
  const identities: BlogResourceIdentities = {
    entityIdentifier: buildEntityIdentifier('blog-post', reference.id),
    thumbnailIdentifier: buildBlogThumbnailIdentifier(reference.id),
    subwireIdentifier: await blogSubwireIdentifier(reference.id),
  };
  const name = reference.publisherName;

  const entity = await verifyResource(deps, 'DOCUMENT', name, identities.entityIdentifier);
  const thumbnail = await verifyResource(deps, 'THUMBNAIL', name, identities.thumbnailIdentifier);
  const subwire = await verifyResource(deps, 'DOCUMENT', name, identities.subwireIdentifier);

  let contentMatches: boolean | null = null;
  if (entity.present && reference.expectedEntityPayload !== undefined) {
    try {
      const text = await deps.reader.fetchText(
        { service: 'DOCUMENT', name, identifier: identities.entityIdentifier },
        { timeoutMs: 15_000 },
      );
      const parsed = parseJsonPayload(text, LIMITS.entityBytes);
      if (parsed.ok) {
        const validated = validateEntityPayload(parsed.value, { expectedKind: 'blog-post' });
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

  let subwireValid: boolean | null = null;
  let subwireCoverMatches: boolean | null = null;
  if (subwire.present) {
    try {
      const text = await deps.reader.fetchText(
        { service: 'DOCUMENT', name, identifier: identities.subwireIdentifier },
        { timeoutMs: 15_000 },
      );
      const parsed = parseJsonPayload(text, SUBWIRE_ARTIFACT_PAYLOAD_CAP_BYTES);
      if (parsed.ok) {
        subwireValid = isSubwireRenderableArticle(parsed.value);
        const cover = (parsed.value as Partial<SubwireArticle> | null)?.coverImage;
        subwireCoverMatches =
          typeof cover?.src === 'string' && typeof reference.expectedSubwireCover === 'string'
            ? cover.src === reference.expectedSubwireCover
            : null;
      } else {
        subwireValid = false;
        subwireCoverMatches = false;
      }
    } catch {
      subwireValid = null;
      subwireCoverMatches = null;
    }
  }

  const subwireDiscovery = await verifySubwireDiscovery(deps, name, identities.subwireIdentifier);

  const present = [entity, thumbnail, subwire];
  const allPresent = present.every((resource) => resource.present === true);
  const anyUnknown = present.some((resource) => resource.present === null);

  let summary: BlogVerifyResult['summary'];
  if (allPresent) {
    summary =
      contentMatches === true && subwireValid === true ? 'confirmed' : 'submitted-unconfirmed';
  } else if (anyUnknown) {
    summary = 'unknown';
  } else {
    summary = 'missing';
  }

  return {
    ...identities,
    entity,
    thumbnail,
    subwire,
    contentMatches,
    subwireValid,
    subwireCoverMatches,
    subwireDiscovery,
    summary,
  };
}

/**
 * Read-only proof of SubWire-side discoverability: run the exact discovery
 * request SubWire issues (its article identifier prefix, DOCUMENT, `mode: 'ALL'`)
 * under the publishing name and check that this publication is in the result set.
 *
 * One bounded page; a failure is reported as `null`, never fabricated.
 */
async function verifySubwireDiscovery(
  deps: BlogPublishDeps,
  publisherName: string,
  subwireIdentifier: string,
): Promise<SubwireDiscoveryVerification> {
  try {
    const prefix = await subwireArticleIdentifierPrefix();
    const raw = await deps.reader.search(
      {
        ...SUBWIRE_ARTICLE_DISCOVERY_REQUEST,
        identifier: prefix,
        name: publisherName,
        limit: 50,
        offset: 0,
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
      if (!record.identifier.startsWith(prefix)) continue;
      hits += 1;
      if (record.identifier === subwireIdentifier) {
        return { found: true, hits, note: null };
      }
    }
    return {
      found: false,
      hits,
      note: `Searched ${raw.length} result(s); this publication's SubWire-compatible identifier was not among them yet. Node search indexes lag a fresh publication.`,
    };
  } catch (error) {
    return {
      found: null,
      hits: 0,
      note: error instanceof Error ? error.message : 'SubWire discovery verification failed.',
    };
  }
}

/** True when an identifier is this publication's Quitter announcement. */
export async function quitterAnnouncementIdOf(identifier: unknown): Promise<string | null> {
  return parseQuitterPostIdentifier(identifier);
}

/** The Quitter entity label, exported so the modal can name the resource family. */
export { QUITTER_POST_ENTITY };
