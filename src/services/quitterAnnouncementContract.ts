/**
 * Quitter announcement contract — Shadow Archives interoperability adapter.
 *
 * This is the ONLY module allowed to know Quitter's identifier math, public
 * salt, post schema and discovery query. No Quitter module is imported and
 * Shadow Archives has no runtime dependency on the Quitter application.
 *
 * VERIFIED 2026-09-13 against current source and live read-only QDN evidence.
 *
 * Source — `Qortal/Quitter` `master` @ 4e4246c3283bcbc8e05e683260692ed36144f862
 * (`git ls-remote origin HEAD` re-checked the same revision at
 * 2026-09-13T16:14Z):
 *   - `src/qapp-config.ts` + `src/AppWrapper.tsx`: qapp-core identity is
 *     `appName: 'quitter'` with the public salt below.
 *   - `src/constants/qdn.ts`: `ENTITY_ROOT = 'ROOT'`, `ENTITY_POST = 'POST'`.
 *   - `src/utils/postQdn.ts` `publishPost`: the post identifier is
 *     `buildIdentifier(ENTITY_POST, ENTITY_ROOT, false)`; the published resource
 *     is `service: 'DOCUMENT'`, `name: <poster name>`,
 *     `base64 = objectToBase64(post)` (base64 of UTF-8 JSON) with the Core
 *     `description` optionally carrying `~hashtag~`/`~@mention~` markers, and the
 *     payload is `{ text, timestamp, name }` plus optional `images` (max 2, each
 *     `{ src: base64 }`) and optional `videos`.
 *   - `src/components/Feed.tsx`: discovery is the entity-params prefix search
 *     (`buildSearchPrefix(ENTITY_POST, ENTITY_ROOT)`, `service: 'DOCUMENT'`,
 *     `prefix: true`, `reverse: true`, `limit: 20`, `mode: 'ALL'`) with no
 *     publishing-name filter, so any name publishing into this family appears in
 *     Quitter's public feed.
 *   - `src/components/Post.tsx` renders `images[].src` by sniffing the base64
 *     magic bytes (`detectImageMimeType`) into a `data:<mime>;base64,` URL and
 *     linkifies bare `qortal://` URLs.
 *   - `Qortal/Subwire` `master` @ a933a6c `src/utils/quitterQdn.ts` performs the
 *     same publication (hardcoding `quitter` + the same salt, `POST` under
 *     `ROOT`) with the payload `{ text, timestamp, name, images? }`, which is the
 *     cross-post this adapter mirrors. The image is SubWire's compressed cover.
 *
 * Live evidence (read-only): Quitter's own discovery prefix returns real posts on
 * qortal-node-a, and a scan of 120 live posts found 19 SubWire cross-posts
 * including the Shadow Archives one
 * (`New publication: …\n\nqortal://APP/Subwire/article/Shadow%20Archives/<id>`
 * with one embedded WebP image). See the task report.
 */

import {
  buildQappIdentifier,
  buildQappSearchPrefix,
  memoizeAsync,
  parseQappIdentifier,
} from './qappIdentifierContract';

/** qapp-core identity of the current Quitter release. */
export const QUITTER_APP_NAME = 'quitter';
export const QUITTER_PUBLIC_SALT = '6hMqDBxky6j1G2wZEHgIiOeApj3x3CP8LQwg0Ok0RVc=';

/** Quitter's public post entity family (`src/constants/qdn.ts`). */
export const QUITTER_POST_ENTITY = 'POST';
export const QUITTER_ROOT_ENTITY = 'ROOT';

/** Quitter rejects a post with more than two images (`postQdn.ts`). */
export const QUITTER_MAX_IMAGES = 2;

const STABLE_ID_LENGTH = 12;

/** One embedded base64 image as Quitter stores it. */
export interface QuitterImage {
  readonly src: string;
}

/**
 * Quitter `Post` payload (`src/utils/postQdn.ts`).
 *
 * Only the fields a plain public text post uses are modelled; `likes`,
 * `retweets`, `replies`, `location` and `repostMetadata` are reply/repost
 * bookkeeping that Quitter recomputes from separate resources.
 */
export interface QuitterPost {
  readonly text: string;
  readonly timestamp: number;
  readonly name: string;
  readonly images?: readonly QuitterImage[];
}

const postPrefix = memoizeAsync(() =>
  buildQappSearchPrefix({
    appName: QUITTER_APP_NAME,
    publicSalt: QUITTER_PUBLIC_SALT,
    entityType: QUITTER_POST_ENTITY,
    parentId: QUITTER_ROOT_ENTITY,
  }),
);

/** The exact identifier prefix Quitter searches for public posts. */
export function quitterPostIdentifierPrefix(): Promise<string> {
  return postPrefix();
}

/**
 * The Quitter post identifier for one Shadow Archives announcement.
 *
 * Quitter itself uses a random 15-character unique id. Shadow Archives supplies
 * its own 12-character stable id instead — the shape is unchanged (the token is
 * opaque to Quitter) and the coordinate becomes deterministic, so an explicit
 * retry after an ambiguous submission overwrites the same post instead of
 * creating a second announcement.
 */
export async function quitterPostIdentifier(id: string): Promise<string> {
  return buildQappIdentifier({
    appName: QUITTER_APP_NAME,
    publicSalt: QUITTER_PUBLIC_SALT,
    entityType: QUITTER_POST_ENTITY,
    parentId: QUITTER_ROOT_ENTITY,
    uid: id,
  });
}

/** Recover the Shadow Archives post id from a Quitter announcement identifier. */
export async function parseQuitterPostIdentifier(identifier: unknown): Promise<string | null> {
  return parseQappIdentifier(identifier, await postPrefix(), STABLE_ID_LENGTH);
}

/**
 * Quitter's public-feed discovery request (`Feed.tsx` + qapp-core `useResources`).
 * The identifier is the async prefix above; the request carries no name filter.
 */
export const QUITTER_POST_DISCOVERY_REQUEST = {
  action: 'SEARCH_QDN_RESOURCES',
  mode: 'ALL',
  service: 'DOCUMENT',
  prefix: true,
  reverse: true,
  limit: 20,
  excludeBlocked: true,
} as const;

/**
 * Read-side gate mirroring what Quitter actually consumes for a public text post
 * (`Post.tsx` reads `text`, `timestamp`, `name` and optional `images[].src`).
 * Quitter has no structural validator, so this is the fail-closed self-check
 * Shadow Archives runs before publishing.
 */
export function isQuitterRenderablePost(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const post = value as Record<string, unknown>;
  if (typeof post.text !== 'string' || post.text.trim().length === 0) return false;
  if (typeof post.timestamp !== 'number' || !Number.isFinite(post.timestamp)) return false;
  if (typeof post.name !== 'string' || post.name.trim().length === 0) return false;
  const images = post.images;
  if (images === undefined) return true;
  if (!Array.isArray(images) || images.length > QUITTER_MAX_IMAGES) return false;
  return images.every((image) => {
    if (!image || typeof image !== 'object') return false;
    const src = (image as Record<string, unknown>).src;
    return typeof src === 'string' && src.length > 0;
  });
}

/**
 * The Shadow Archives article deep link for one publication.
 *
 * The publishing name is percent-encoded: a raw space would terminate Quitter's
 * bare-URL linkification, and Core's `q-apps.js` resolves the encoded form to
 * `/render/APP/<name>/blog/<id>` (verified in Core `108bf191`).
 */
export function shadowArchivesArticleUrl(publisherName: string, id: string): string {
  return `qortal://APP/${encodeURIComponent(publisherName)}/blog/${id}`;
}

export interface QuitterAnnouncementInput {
  readonly title: string;
  /** Post excerpt; the first line of the announcement body. */
  readonly excerpt: string;
  /** Shadow Archives article URL (product-truth reference). */
  readonly articleUrl: string;
  /** SubWire-compatible article URL, so ecosystem readers can open it natively. */
  readonly subwireUrl: string;
}

/**
 * Prefilled, owner-editable announcement text.
 *
 * Mirrors SubWire's own cross-post shape (`New publication: <title>` followed by
 * the article URL) and adds the SubWire-compatible coordinate, then the excerpt.
 * The references come *before* the excerpt because Quitter collapses a post's
 * text at `MAX_TEXT_LENGTH = 280` (`components/Post.tsx`): with the excerpt first
 * a longer preview would push the article link out of the collapsed view, which
 * is exactly what SubWire's own share text avoids. The owner can edit or clear
 * anything before the explicit Quitter step.
 */
export function buildQuitterAnnouncementText(input: QuitterAnnouncementInput): string {
  const lines: string[] = [
    `New publication: ${input.title.trim()}`,
    '',
    input.articleUrl,
    input.subwireUrl,
  ];
  const excerpt = input.excerpt.trim();
  if (excerpt.length > 0) lines.push('', excerpt);
  return lines.join('\n').trim();
}

export interface QuitterPostInput {
  readonly text: string;
  readonly name: string;
  readonly timestamp: number;
  /** WebP base64 (no data-URL prefix) for the cover image, or null for text only. */
  readonly coverBase64: string | null;
}

/** Build the Quitter payload; the image is omitted entirely when absent. */
export function buildQuitterPost(input: QuitterPostInput): QuitterPost {
  const cover = input.coverBase64?.trim() ?? '';
  return {
    text: input.text.trim(),
    timestamp: input.timestamp,
    name: input.name,
    ...(cover.length > 0 ? { images: [{ src: cover }] } : {}),
  };
}
