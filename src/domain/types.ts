/**
 * Runtime-validated Shadow Archives domain types.
 *
 * TypeScript types alone do not validate untrusted QDN payloads; every value
 * here is produced by a validator in `./entities.ts` / `./catalog.ts`.
 */

import type { EntityKind, EntityState } from './constants';

/** QDN identity triple. `identifier: null` means the resource's default resource. */
export interface QdnResourceIdentity {
  readonly service: string;
  readonly name: string;
  readonly identifier: string | null;
}

/** Media reference where the identifier is explicit and required. */
export interface QdnMediaReference {
  readonly service: string;
  readonly name: string;
  readonly identifier: string;
  readonly path?: string;
  readonly mimeType?: string;
}

/** Normalized taxonomy value: display label plus canonical slug. */
export interface TaxonomyReference {
  readonly label: string;
  readonly slug: string;
}

/** TipTap/ProseMirror JSON node subset. Unknown node types are dropped at render. */
export interface RichTextNode {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
  readonly marks?: readonly RichTextMark[];
  readonly content?: readonly RichTextNode[];
  readonly text?: string;
}

export interface RichTextMark {
  readonly type: string;
  readonly attrs?: Readonly<Record<string, unknown>>;
}

/** Canonical stored rich text (owner decision D4). */
export interface RichTextDocument {
  readonly format: 'tiptap-json-v1';
  readonly doc: RichTextNode;
}

/** Common entity envelope (contract §4). */
export interface EntityEnvelope {
  readonly schemaVersion: number;
  readonly kind: EntityKind;
  readonly id: string;
  /** Informational display hint only — never an authority test. */
  readonly publisher: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly state: EntityState;
}

export interface BlogPostData {
  readonly title: string;
  readonly slug: string;
  readonly excerpt: string;
  readonly body: RichTextDocument;
  readonly bodyText: string;
  readonly thumbnail: QdnMediaReference | null;
  readonly categories: readonly string[];
  readonly tags: readonly string[];
  readonly language: string;
}

export interface BlogPost extends EntityEnvelope {
  readonly kind: 'blog-post';
  readonly data: BlogPostData;
}

export interface VideoEntryData {
  readonly title: string;
  readonly slug: string;
  readonly description: string;
  readonly media: QdnMediaReference;
  readonly externalMedia: QdnMediaReference | null;
  readonly thumbnail: QdnMediaReference | null;
  readonly durationSeconds: number;
  readonly categories: readonly string[];
  readonly tags: readonly string[];
  readonly language: string;
}

export interface VideoEntry extends EntityEnvelope {
  readonly kind: 'video';
  readonly data: VideoEntryData;
}

export interface GalleryItemData {
  readonly title: string;
  readonly description: string;
  readonly albumId: string | null;
  readonly media: QdnMediaReference;
  readonly thumbnail: QdnMediaReference | null;
  readonly width: number;
  readonly height: number;
  readonly categories: readonly string[];
  readonly tags: readonly string[];
  readonly language: string;
}

export interface GalleryItem extends EntityEnvelope {
  readonly kind: 'gallery-item';
  readonly data: GalleryItemData;
}

export interface GalleryAlbumData {
  readonly title: string;
  readonly description: string;
  readonly coverThumbnail: QdnMediaReference | null;
  readonly categories: readonly string[];
  readonly tags: readonly string[];
  readonly language: string;
}

export interface GalleryAlbum extends EntityEnvelope {
  readonly kind: 'gallery-album';
  readonly data: GalleryAlbumData;
}

export type ShadowArchiveEntity = BlogPost | VideoEntry | GalleryItem | GalleryAlbum;

/** Catalog locator entry (contract §7.2). */
export interface CatalogEntry {
  readonly id: string;
  readonly service: string;
  readonly identifier: string;
  readonly title: string;
  readonly slug: string;
  readonly excerpt: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly categories: readonly string[];
  readonly tags: readonly string[];
  readonly thumbnail: QdnMediaReference | null;
  readonly state: EntityState;
  readonly contentHash: string | null;
  /** Engagement snapshot; carried but never used for ranking in Phase 2A. */
  readonly likeCount: number | null;
  readonly commentCount: number | null;
  readonly countsCompiledAt: number | null;
  /** Type-specific listing metadata. */
  readonly durationSeconds: number | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly albumId: string | null;
}

export interface CatalogPartitionDescriptor {
  readonly identifier: string;
  readonly type: EntityKind;
  readonly count: number;
  readonly maxUpdated: number | null;
  readonly checksum: string | null;
}

export interface CatalogManifest {
  readonly schemaVersion: number;
  readonly kind: 'catalog-manifest';
  readonly catalogVersion: number;
  readonly compiledAt: number;
  readonly publisherName: string | null;
  readonly partitions: readonly CatalogPartitionDescriptor[];
  readonly taxonomy: {
    readonly categories: readonly string[];
    readonly tags: readonly string[];
  };
}

/** A catalog entry with its partition type attached (reader-level record). */
export interface CatalogListing extends CatalogEntry {
  readonly type: EntityKind;
  readonly partitionIdentifier: string;
}
