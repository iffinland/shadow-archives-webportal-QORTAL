/**
 * Q-Tube video publication/discovery contract — Shadow Archives interoperability
 * adapter (pure data/functions; no Q-Tube module is imported and Shadow Archives
 * has no runtime dependency on the Q-Tube application).
 *
 * This is the ONLY module allowed to know Q-Tube's identifier family, metadata
 * schema and discovery query. Everything Q-Tube-specific about a Shadow Archives
 * video publication lives here; the Shadow Archives entity/catalog remain the
 * canonical, app-owned model.
 *
 * VERIFIED 2026-09-13 against current source + live read-only QDN evidence:
 *
 * 1. `Qortal/q-tube` `main` @ 68c3ea706c4ab110ffa44a7f55f8e09bdf7e85ff
 *    (`git ls-remote origin HEAD` re-checked the same revision):
 *      - `src/constants/Identifiers.ts` — `QTUBE_VIDEO_BASE = 'qtube_vid_'`,
 *        `QTUBE_PLAYLIST_BASE = 'qtube_playlist_'`.
 *      - `src/components/Publish/PublishVideo/useVideoPublishingWorkflow.tsx` —
 *        the two-resource publish (DOCUMENT metadata + VIDEO media), the exact
 *        `identifier`/`_metadata`/`tag1`/`filename`/Core-metadata shape, and the
 *        `VideoMetadata` payload fields.
 *      - `src/utils/checkStructure.ts` — the discovery-time validity gate:
 *        required `title`, `videoReference`, `filename`; `duration`/`fileSize`
 *        optional.
 *      - `src/pages/Home/Home.tsx`, `.../Home/Components/VideoListComponentLevel.tsx`,
 *        `src/pages/Search/Search.tsx` — discovery is
 *        `SEARCH_QDN_RESOURCES { service: 'DOCUMENT', identifier: 'qtube_vid_',
 *        mode: 'ALL', ... }` with no `prefix`, i.e. identifier *substring* match.
 *      - `src/pages/ContentPages/VideoContent/VideoContent-State.ts` — the detail
 *        route resolves the metadata DOCUMENT by its exact identifier and plays
 *        `videoReference` through `/arbitrary/<service>/<name>/<identifier>`.
 * 2. Live read-only QDN evidence (qortal-node-a `http://127.0.0.1:24991`,
 *    Core 6.1.9): `GET /arbitrary/resources/search?service=DOCUMENT&identifier=qtube_vid_`
 *    returns real publications, and a real metadata resource contains the exact
 *    fields mirrored below (including a `videoImage` data URL).
 * 3. `Qortal/Subwire` `master` @ a933a6c44d60db19cd219408e36c747aebcce994
 *    reuses the same family and treats the media resource identifier as the
 *    metadata identifier with the `_metadata` suffix removed (see
 *    `src/utils/articleQdn.ts`), which is why the media resource published by
 *    this adapter lives at `<base>` (metadata identifier minus `_metadata`).
 *
 * Category data note: the numeric Q-Tube category table below is a *data
 * contract mirror* used to populate the metadata `category` field that Q-Tube's
 * category filter searches (`description: 'category:<id>;'`). It is not Q-Tube
 * code, and no Q-Tube module is imported. It must be re-checked when the
 * `Qortal/q-tube` revision above changes.
 */

import { isStableId } from '../domain/identifiers';

/** `QTUBE_VIDEO_BASE` (`q-tube/src/constants/Identifiers.ts`). */
export const QTUBE_VIDEO_IDENTIFIER_BASE = 'qtube_vid_';

/** Q-Tube publishes the metadata DOCUMENT at `<base identifier>_metadata`. */
export const QTUBE_METADATA_IDENTIFIER_SUFFIX = '_metadata';

/** `tag1` on both published resources; Core stores it as `metadata.tags[0]`. */
export const QTUBE_VIDEO_TAG = QTUBE_VIDEO_IDENTIFIER_BASE;

/** Core metadata caps Q-Tube itself respects (`title.slice(0,50)`). */
export const QTUBE_CORE_TITLE_MAX = 50;

/**
 * App-imposed cap for the interoperability metadata artifact.
 *
 * The payload carries the poster twice as base64 (the `videoImage` and the
 * single `extracts` frame), so it is larger than a Shadow Archives entity
 * envelope. `DOCUMENT` has no Core cap; this bound keeps the publish honest and
 * bounded while leaving ample headroom above the 256 KiB poster policy.
 */
export const QTUBE_METADATA_PAYLOAD_CAP_BYTES = 1024 * 1024;

/** The VIDEO resource coordinate for one publication. */
export function qtubeVideoIdentifier(id: string): string {
  return `${QTUBE_VIDEO_IDENTIFIER_BASE}${id}`;
}

/** The metadata DOCUMENT coordinate for one publication. */
export function qtubeMetadataIdentifier(id: string): string {
  return `${qtubeVideoIdentifier(id)}${QTUBE_METADATA_IDENTIFIER_SUFFIX}`;
}

/** Recover the Shadow Archives stable id from a Q-Tube metadata identifier. */
export function parseQtubeMetadataIdentifier(identifier: unknown): string | null {
  if (typeof identifier !== 'string') return null;
  if (!identifier.startsWith(QTUBE_VIDEO_IDENTIFIER_BASE)) return null;
  if (!identifier.endsWith(QTUBE_METADATA_IDENTIFIER_SUFFIX)) return null;
  const id = identifier.slice(
    QTUBE_VIDEO_IDENTIFIER_BASE.length,
    identifier.length - QTUBE_METADATA_IDENTIFIER_SUFFIX.length,
  );
  return isStableId(id) ? id : null;
}

/** Recover the Shadow Archives stable id from a Q-Tube media identifier. */
export function parseQtubeVideoIdentifier(identifier: unknown): string | null {
  if (typeof identifier !== 'string') return null;
  if (!identifier.startsWith(QTUBE_VIDEO_IDENTIFIER_BASE)) return null;
  const id = identifier.slice(QTUBE_VIDEO_IDENTIFIER_BASE.length);
  return isStableId(id) ? id : null;
}

/** A QDN resource coordinate as Q-Tube's `videoReference` stores it. */
export interface QtubeVideoReference {
  readonly name: string;
  readonly identifier: string;
  readonly service: string;
}

/**
 * Q-Tube `VideoMetadata` payload (the discoverable object).
 *
 * Field-for-field the shape Q-Tube writes in
 * `useVideoPublishingWorkflow.tsx` (`VideoMetadata`). Field names and optional
 * fields are part of the discovery contract and must not be renamed.
 */
export interface QtubeVideoMetadata {
  readonly title: string;
  readonly version: number;
  readonly fullDescription: string;
  readonly htmlDescription: string;
  readonly videoImage: string | null;
  readonly videoReference: QtubeVideoReference;
  readonly extracts: readonly string[];
  readonly commentsId: string;
  readonly category: string;
  readonly subcategory: string;
  readonly code: string;
  readonly videoType: string;
  readonly filename: string;
  readonly fileSize: number;
  readonly duration: number;
}

/** Q-Tube's required metadata fields (`checkStructure.ts` → `isValidVideoMetadata`). */
export const QTUBE_VIDEO_METADATA_REQUIRED_FIELDS = [
  'title',
  'videoReference',
  'filename',
] as const;

const QORTAL_SERVICES: ReadonlySet<string> = new Set([
  'APP',
  'ARBITRARY_DATA',
  'ATTACHMENT',
  'ATTACHMENT_PRIVATE',
  'AUDIO',
  'AUDIO_PRIVATE',
  'AUTO_UPDATE',
  'BLOG',
  'BLOG_COMMENT',
  'BLOG_POST',
  'CHAIN_COMMENT',
  'CHAIN_DATA',
  'CODE',
  'COMMENT',
  'COUPON',
  'DATABASE',
  'DOCUMENT',
  'DOCUMENT_PRIVATE',
  'EXTENSION',
  'FILE',
  'FILE_PRIVATE',
  'FILES',
  'GAME',
  'GIF_REPOSITORY',
  'IMAGE',
  'IMAGE_PRIVATE',
  'ITEM',
  'JSON',
  'LIST',
  'MAIL',
  'MAIL_PRIVATE',
  'MESSAGE',
  'MESSAGE_PRIVATE',
  'METADATA',
  'NFT',
  'OFFER',
  'PLAYLIST',
  'PLUGIN',
  'PODCAST',
  'PRODUCT',
  'QCHAT_ATTACHMENT',
  'QCHAT_ATTACHMENT_PRIVATE',
  'QCHAT_AUDIO',
  'QCHAT_IMAGE',
  'QCHAT_VOICE',
  'SNAPSHOT',
  'STORE',
  'THUMBNAIL',
  'VIDEO',
  'VIDEO_PRIVATE',
  'VOICE',
  'VOICE_PRIVATE',
  'WEBSITE',
]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/** Mirrors Q-Tube's `isValidVideoReference` (`checkStructure.ts`). */
export function isValidQtubeVideoReference(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const ref = value as Record<string, unknown>;
  if (!isNonEmptyString(ref.name)) return false;
  if (!isNonEmptyString(ref.identifier)) return false;
  if (!isNonEmptyString(ref.service)) return false;
  return QORTAL_SERVICES.has(ref.service);
}

/**
 * The exact validity gate Q-Tube applies to a discovered metadata payload
 * (`isValidVideoMetadata`). Shadow Archives runs it against the *served* resource
 * after publication, so the interoperability claim is checked against Q-Tube's
 * own rule rather than an internal assumption.
 *
 * `duration`/`fileSize` are optional (legacy Q-Tube videos predate them); a
 * present `duration` must be a non-negative number.
 */
export function isValidQtubeVideoMetadata(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const video = value as Record<string, unknown>;
  for (const field of QTUBE_VIDEO_METADATA_REQUIRED_FIELDS) {
    if (video[field] === undefined || video[field] === null) return false;
  }
  if (!isNonEmptyString(video.title)) return false;
  if (!isNonEmptyString(video.filename)) return false;
  if (!isValidQtubeVideoReference(video.videoReference)) return false;
  if (video.duration !== undefined && video.duration !== null) {
    if (typeof video.duration !== 'number' || Number.isNaN(video.duration) || video.duration < 0) {
      return false;
    }
  }
  return true;
}

/**
 * Q-Tube's discovery request, exactly as the current source issues it.
 *
 * `identifier` is matched as a *substring* because Q-Tube does not set
 * `prefix`; `mode: 'ALL'` is mandatory because Core's default `LATEST` returns
 * only one resource per `(name, service)` and would hide every other video.
 * Shadow Archives uses this shape only to *verify* Q-Tube-side discoverability;
 * Shadow Archives' own discovery stays scoped to its `saw_vid_` namespace.
 */
export const QTUBE_VIDEO_DISCOVERY_REQUEST = {
  service: 'DOCUMENT',
  identifier: QTUBE_VIDEO_IDENTIFIER_BASE,
  mode: 'ALL',
  reverse: true,
  limit: 20,
  offset: 0,
} as const;

/* -------------------------------------------------------------------------- */
/* Category mirror                                                            */
/* -------------------------------------------------------------------------- */

/**
 * `Qortal/q-tube` `src/constants/Categories.ts` top-level categories, pinned to
 * the revision above. Q-Tube's `category` field is the numeric id as a string
 * and its category filter searches `description` for `category:<id>;`.
 */
export const QTUBE_TOP_LEVEL_CATEGORIES: readonly { readonly id: number; readonly name: string }[] =
  [
    { id: 1, name: 'Movies' },
    { id: 2, name: 'Series' },
    { id: 3, name: 'Music' },
    { id: 4, name: 'Education' },
    { id: 5, name: 'Lifestyle' },
    { id: 6, name: 'Gaming' },
    { id: 7, name: 'Technology' },
    { id: 8, name: 'Sports' },
    { id: 9, name: 'News & Politics' },
    { id: 10, name: 'Cooking & Food' },
    { id: 11, name: 'Animation' },
    { id: 12, name: 'Science' },
    { id: 13, name: 'Health & Wellness' },
    { id: 14, name: 'DIY & Crafts' },
    { id: 15, name: 'Kids & Family' },
    { id: 16, name: 'Comedy' },
    { id: 17, name: 'Travel & Adventure' },
    { id: 18, name: 'Art & Design' },
    { id: 19, name: 'Nature & Environment' },
    { id: 20, name: 'Business & Finance' },
    { id: 21, name: 'Personal Development' },
    { id: 22, name: 'Religion' },
    { id: 23, name: 'History' },
    { id: 24, name: 'Anime' },
    { id: 25, name: 'Cartoons' },
    { id: 26, name: 'Qortal' },
    { id: 27, name: 'Paranormal' },
    { id: 28, name: 'Spirituality' },
    { id: 29, name: 'Privacy' },
    { id: 99, name: 'Other' },
  ];

/** Q-Tube's `Other` bucket; also the safe default when no label matches. */
export const QTUBE_CATEGORY_OTHER_ID = 99;

function normalizeCategoryLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Derive Q-Tube's numeric category id from Shadow Archives' own taxonomy
 * (owner decision D2: the app taxonomy is canonical, Core/Q-Tube metadata is a
 * discoverability mirror). Unmatched labels fall back to Q-Tube's `Other`.
 */
export function qtubeCategoryIdFor(labels: readonly string[]): number {
  const normalized = labels.map(normalizeCategoryLabel).filter((value) => value.length > 0);
  for (const category of QTUBE_TOP_LEVEL_CATEGORIES) {
    if (category.id === QTUBE_CATEGORY_OTHER_ID) continue;
    if (normalized.includes(normalizeCategoryLabel(category.name))) return category.id;
  }
  return QTUBE_CATEGORY_OTHER_ID;
}

/* -------------------------------------------------------------------------- */
/* Metadata construction                                                      */
/* -------------------------------------------------------------------------- */

export interface QtubeVideoMetadataInput {
  readonly title: string;
  /** Plain-text description (Q-Tube `fullDescription`). */
  readonly description: string;
  /** HTML description (Q-Tube `htmlDescription`); plain text is used when absent. */
  readonly htmlDescription?: string | null;
  /**
   * Thumbnail as a data URL (Q-Tube `videoImage`). Q-Tube's own publications
   * embed a data URL here, so a Shadow Archives thumbnail is embedded the same
   * way: the artifact stays self-contained for every Q-Tube surface.
   */
  readonly thumbnailDataUrl: string | null;
  /** The published VIDEO resource coordinate. */
  readonly media: QtubeVideoReference;
  /** Numeric Q-Tube category id and subcategory id (subcategory is usually empty). */
  readonly categoryId: number;
  readonly subcategoryId?: string;
  /** Stable short code; Q-Tube uses it for playlist grouping. */
  readonly code: string;
  readonly videoType: string;
  readonly filename: string;
  readonly fileSize: number;
  readonly durationSeconds: number;
}

/** Q-Tube's `commentsId` shape (`${QTUBE_VIDEO_BASE}_cm_${code}`). */
export function qtubeCommentsId(code: string): string {
  return `${QTUBE_VIDEO_IDENTIFIER_BASE}_cm_${code}`;
}

/**
 * Build the Q-Tube metadata payload for one publication.
 *
 * Deliberately mirrors Q-Tube's own construction rather than inventing a
 * "compatible-enough" subset: `version: 1`, `fullDescription` plain text,
 * `htmlDescription` HTML, `extracts` seeded with the thumbnail so Q-Tube's hover
 * preview has a frame instead of its "deleted video" placeholder, and the exact
 * `commentsId`/`code`/`category` shape.
 */
export function buildQtubeVideoMetadata(input: QtubeVideoMetadataInput): QtubeVideoMetadata {
  const plain = input.description.trim();
  const html = (input.htmlDescription ?? '').trim();
  return {
    title: input.title.trim(),
    version: 1,
    fullDescription: plain,
    htmlDescription: html.length > 0 ? html : plain,
    videoImage: input.thumbnailDataUrl,
    videoReference: {
      name: input.media.name,
      identifier: input.media.identifier,
      service: input.media.service,
    },
    extracts: input.thumbnailDataUrl ? [input.thumbnailDataUrl] : [],
    commentsId: qtubeCommentsId(input.code),
    category: String(input.categoryId),
    subcategory: input.subcategoryId ?? '',
    code: input.code,
    videoType: input.videoType,
    filename: input.filename,
    fileSize: input.fileSize,
    duration: input.durationSeconds,
  };
}

/**
 * Q-Tube's Core-level metadata mirror for the metadata DOCUMENT.
 *
 * Q-Tube writes `title.slice(0,50)` and a description of the form
 * `**category:<id>;subcategory:<id>;code:<code>**<plain text>`; the category
 * filter searches that description string, so the shape is part of discovery.
 */
export function qtubeCoreMetadataDescription(input: {
  readonly categoryId: number;
  readonly subcategoryId?: string;
  readonly code: string;
  readonly description: string;
}): string {
  const marker = `**category:${input.categoryId};subcategory:${input.subcategoryId ?? ''};code:${input.code}**`;
  return `${marker}${input.description.trim().slice(0, 150)}`;
}
