/**
 * Content-facing view models shared by the shell regions and feature routes.
 *
 * These are populated from validated `CatalogListing` records; the domain layer
 * (`src/domain`, `src/services`) owns validation and the QDN read pipeline.
 */

import type { ArchiveSource } from '../services/types';

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
  /** Canonical app taxonomy values for chips/links. */
  readonly categories?: readonly string[];
  readonly tags?: readonly string[];
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
  /** True when coverage/results cannot be established as complete. */
  readonly partial?: boolean;
  /** True when the data came from an expired cache entry. */
  readonly stale?: boolean;
  readonly source?: ArchiveSource;
  readonly onRetry?: () => void;
}
