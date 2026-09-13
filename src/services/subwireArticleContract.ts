/**
 * SubWire article publication/discovery contract — Shadow Archives
 * interoperability adapter.
 *
 * This is the ONLY module allowed to know SubWire's identifier math, public
 * salt, article schema, Markdown/embedded-image model and discovery query. No
 * SubWire module is imported, no SubWire source is vendored, and Shadow Archives
 * has no runtime dependency on the SubWire application: the Shadow Archives
 * entity and catalog stay canonical, and the SubWire artifact is a derived,
 * rebuildable resource.
 *
 * VERIFIED 2026-09-13 against current source and live read-only QDN evidence.
 *
 * Source — `Qortal/Subwire` `master` @ a933a6c44d60db19cd219408e36c747aebcce994
 * (`git ls-remote origin HEAD` re-checked the same revision at
 * 2026-09-13T16:14Z):
 *   - `src/qapp-config.ts` + `src/AppWrapper.tsx`: the qapp-core identity is
 *     `appName: 'subwire'`, `publicSalt: '0drEPfUciLNhQZF9NFBg6RLnwcff/g3Ic7mm3VrIJKw='`
 *     (no test-identifier branch is active: `useTestIdentifiers = false`).
 *   - `src/utils/articleQdn.ts`: `ENTITY_ROOT = 'SUBWIRE_ROOT'`,
 *     `ENTITY_ARTICLE = 'SUBWIRE_ARTICLE'`; an article identifier is
 *     `identifierOperations.buildIdentifier(ENTITY_ARTICLE, ENTITY_ROOT, false)`;
 *     the published resource is `service: 'DOCUMENT'`, `name: <owner name>`,
 *     `data64 = objectToBase64(article)` (base64 of the UTF-8 JSON, no data-URL
 *     prefix) with Core `title` truncated to 75 bytes and `description` to 180
 *     bytes. Body images live inside the article as base64 (`images[]`) and are
 *     referenced from `content` as `![](subwire-image://<index>)`; the cover image
 *     is always inline base64 in `coverImage.src` (never a separate resource).
 *   - `src/pages/DiscoverPage.tsx`: discovery is
 *     `SEARCH_QDN_RESOURCES { service: 'DOCUMENT', identifier: <article prefix>,
 *     prefix: true, limit: 20, reverse: true }`, with no publishing-name filter —
 *     so any name publishing into this identifier family is discovered.
 *   - `qapp-core` `src/hooks/useResources.tsx` adds `mode: 'ALL'` and
 *     `excludeBlocked: true`, and drops results whose `size` is 32 or >= 5 MiB.
 *   - `src/components/ArticleCard.tsx` / `src/pages/ArticlePage.tsx` render
 *     `coverImage.src` ONLY as `data:image/webp;base64,<src>` and render
 *     `content` through `marked.parse(content, { breaks: true, gfm: true })`
 *     with no sanitizer.
 *
 * Live evidence (read-only): `SEARCH_QDN_RESOURCES` on qortal-node-a
 * (`http://127.0.0.1:24991`) with the prefix derived below returns real SubWire
 * publications, including one published under the Shadow Archives name, and two
 * real Quitter announcement posts point at them
 * (`qortal://APP/Subwire/article/<name>/<identifier>`); see the task report.
 */

import {
  buildQappIdentifier,
  buildQappSearchPrefix,
  memoizeAsync,
  parseQappIdentifier,
} from './qappIdentifierContract';

/** qapp-core identity of the current SubWire release. */
export const SUBWIRE_APP_NAME = 'subwire';
export const SUBWIRE_PUBLIC_SALT = '0drEPfUciLNhQZF9NFBg6RLnwcff/g3Ic7mm3VrIJKw=';

/** SubWire's public article entity family (`src/utils/articleQdn.ts`). */
export const SUBWIRE_ARTICLE_ENTITY = 'SUBWIRE_ARTICLE';
export const SUBWIRE_ROOT_ENTITY = 'SUBWIRE_ROOT';
export const SUBWIRE_EPISODE_ENTITY = 'SUBWIRE_EPISODE';

/** Shadow Archives only publishes text articles; episodes are not in scope. */
export const SUBWIRE_ARTICLE_TYPE = 'essay';

/** Fixed identifier length of a Shadow Archives stable id. */
const STABLE_ID_LENGTH = 12;

/** SubWire's Core metadata truncation (`truncateByBytes` in `articleQdn.ts`). */
export const SUBWIRE_TITLE_MAX_BYTES = 75;
export const SUBWIRE_DESCRIPTION_MAX_BYTES = 180;

/**
 * `useResources` drops hits at or above 5 MiB, so a derived artifact that large
 * would be invisible to SubWire. Fail closed well below it instead of publishing
 * an undiscoverable resource.
 */
export const SUBWIRE_ARTIFACT_PAYLOAD_CAP_BYTES = 4 * 1024 * 1024;

/** The `THUMBNAIL` service cap; the cover artifact must satisfy it. */
export const SUBWIRE_COVER_SERVICE_LIMIT_BYTES = 500 * 1024;

/** One embedded base64 image as SubWire stores it. */
export interface SubwireArticleImage {
  readonly name: string;
  readonly src: string;
}

/** A media reference inside an article (kept for shape completeness). */
export interface SubwireArticleMedia {
  readonly identifier: string;
  readonly name: string;
  readonly service: string;
  readonly mimeType?: string;
}

/**
 * SubWire `Article` payload (`src/utils/articleQdn.ts`).
 *
 * Field names are the contract: SubWire reads them directly. `images`/`media`
 * are omitted when empty, exactly as SubWire itself omits them.
 */
export interface SubwireArticle {
  readonly title: string;
  readonly subtitle?: string;
  /** GFM Markdown, possibly carrying `subwire-image://<index>` references. */
  readonly content: string;
  readonly coverImage: SubwireArticleImage;
  readonly images?: readonly SubwireArticleImage[];
  readonly media?: readonly SubwireArticleMedia[];
  readonly timestamp: number;
  readonly name: string;
  readonly type: 'essay' | 'episode';
  readonly published: boolean;
}

/** Truncate to a byte budget without splitting a UTF-8 code point. */
export function truncateUtf8Bytes(text: string, maxBytes: number): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return '';
  const encoder = new TextEncoder();
  let bytes = 0;
  let out = '';
  for (const character of trimmed) {
    const size = encoder.encode(character).length;
    if (bytes + size > maxBytes) break;
    bytes += size;
    out += character;
  }
  return out;
}

/** SubWire's Core metadata title (`truncateByBytes(title, 75)`). */
export function subwireCoreTitle(title: string): string {
  return truncateUtf8Bytes(title, SUBWIRE_TITLE_MAX_BYTES);
}

/** SubWire's Core metadata description (`truncateByBytes(subtitle, 180)`). */
export function subwireCoreDescription(subtitle: string): string {
  return truncateUtf8Bytes(subtitle, SUBWIRE_DESCRIPTION_MAX_BYTES);
}

const articlePrefix = memoizeAsync(() =>
  buildQappSearchPrefix({
    appName: SUBWIRE_APP_NAME,
    publicSalt: SUBWIRE_PUBLIC_SALT,
    entityType: SUBWIRE_ARTICLE_ENTITY,
    parentId: SUBWIRE_ROOT_ENTITY,
  }),
);

/** The exact identifier prefix SubWire searches for articles. */
export function subwireArticleIdentifierPrefix(): Promise<string> {
  return articlePrefix();
}

/**
 * The SubWire article identifier for one Shadow Archives post id.
 *
 * Deterministic by construction: the Shadow Archives stable id replaces
 * qapp-core's random unique id, so the SubWire-visible coordinate is recoverable
 * from the canonical id alone and a retry overwrites instead of duplicating.
 */
export async function subwireArticleIdentifier(id: string): Promise<string> {
  return buildQappIdentifier({
    appName: SUBWIRE_APP_NAME,
    publicSalt: SUBWIRE_PUBLIC_SALT,
    entityType: SUBWIRE_ARTICLE_ENTITY,
    parentId: SUBWIRE_ROOT_ENTITY,
    uid: id,
  });
}

/** Recover the Shadow Archives post id from a SubWire article identifier. */
export async function parseSubwireArticleIdentifier(identifier: unknown): Promise<string | null> {
  return parseQappIdentifier(identifier, await articlePrefix(), STABLE_ID_LENGTH);
}

/**
 * SubWire's article discovery request.
 *
 * `qapp-core`'s `useResources` merges these params into
 * `qortalRequest({ action: 'SEARCH_QDN_RESOURCES', mode: 'ALL', ... })`. The
 * identifier is the async prefix above; no `names` filter is applied by SubWire,
 * so it is omitted here too (the Shadow Archives verification additionally
 * restricts to its own publishing name to prove *its* publication is found).
 */
export const SUBWIRE_ARTICLE_DISCOVERY_REQUEST = {
  action: 'SEARCH_QDN_RESOURCES',
  mode: 'ALL',
  service: 'DOCUMENT',
  prefix: true,
  reverse: true,
  limit: 20,
  excludeBlocked: true,
} as const;

/**
 * Read-side gate mirroring what SubWire actually consumes.
 *
 * SubWire has no `checkStructure`-style validator; `ArticleCard`/`ArticlePage`
 * read these fields directly and degrade gracefully when one is missing, so this
 * predicate describes the fields Shadow Archives promises to provide rather than
 * a rejection rule SubWire enforces. It is still run as a fail-closed self-check
 * before publication.
 */
export function isSubwireRenderableArticle(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const article = value as Record<string, unknown>;
  if (typeof article.title !== 'string' || article.title.trim().length === 0) return false;
  if (typeof article.content !== 'string' || article.content.trim().length === 0) return false;
  if (article.type !== 'essay' && article.type !== 'episode') return false;
  if (article.published !== true) return false;
  if (typeof article.timestamp !== 'number' || !Number.isFinite(article.timestamp)) return false;
  if (typeof article.name !== 'string' || article.name.trim().length === 0) return false;
  const cover = article.coverImage;
  if (!cover || typeof cover !== 'object') return false;
  const src = (cover as Record<string, unknown>).src;
  return typeof src === 'string' && src.length > 0;
}

export interface SubwireArticleInput {
  readonly title: string;
  /** Excerpt/summary; also SubWire's `subtitle` and Core description source. */
  readonly excerpt: string;
  /** Derived GFM Markdown (`domain/richTextMarkdown.ts`). */
  readonly markdown: string;
  /** WebP base64 (no data-URL prefix); SubWire renders it as `data:image/webp;base64,`. */
  readonly coverBase64: string;
  readonly coverFileName: string;
  readonly timestamp: number;
  readonly publisherName: string;
}

/**
 * Build the derived SubWire article payload for one Shadow Archives post.
 *
 * Deliberately mirrors SubWire's own construction: `type: 'essay'`,
 * `published: true`, inline base64 cover, no empty `images`/`media` keys.
 */
export function buildSubwireArticle(input: SubwireArticleInput): SubwireArticle {
  const subtitle = input.excerpt.trim();
  return {
    title: input.title.trim(),
    ...(subtitle.length > 0 ? { subtitle } : {}),
    content: input.markdown,
    coverImage: { name: input.coverFileName, src: input.coverBase64 },
    timestamp: input.timestamp,
    name: input.publisherName,
    type: SUBWIRE_ARTICLE_TYPE,
    published: true,
  };
}

/**
 * The SubWire deep link for one publication.
 *
 * The publishing name is percent-encoded because a raw space would end Quitter's
 * bare-URL linkification; `q-apps.js` `extractComponents`/`buildResourceUrl`
 * then resolves it to `/render/APP/<name>/<path>` (verified in Core `108bf191`
 * `src/main/resources/q-apps/q-apps.js`).
 */
export function subwireArticleUrl(publisherName: string, identifier: string): string {
  return `qortal://APP/Subwire/article/${encodeURIComponent(publisherName)}/${identifier}`;
}
