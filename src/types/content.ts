/**
 * Content-facing view models shared by the shell regions and feature routes.
 *
 * These are intentionally shaped so the future `saw_*` QDN catalog can populate
 * them without changing component geometry or route contracts. Phase 1B does
 * not fetch or fabricate any of this data.
 */

/** Explicit data state machine (Phase 1A §1.5). Never collapse failure into "empty". */
export type LoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'unavailable' | 'error';

export interface MediaDescriptor {
  readonly src: string;
  /** Thumbnail-sized asset only — never the gallery original or video bytes. */
  readonly alt: string;
  readonly width: number;
  readonly height: number;
}

export type ContentKind = 'post' | 'video' | 'gallery';

export interface ContentCardModel {
  readonly id: string;
  readonly kind: ContentKind;
  readonly title: string;
  readonly description?: string;
  readonly href: string;
  readonly media?: MediaDescriptor;
  /** Optional duration badge text for video cards. */
  readonly durationLabel?: string;
}

export interface TopListEntry {
  readonly id: string;
  readonly title: string;
  readonly href: string;
}

export interface CollectionState<T> {
  readonly status: LoadState;
  readonly items: readonly T[];
  /** Human-readable, non-fabricated explanation for non-ready states. */
  readonly message?: string;
}
