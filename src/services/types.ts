import type { CatalogListing, TaxonomyReference, ShadowArchiveEntity } from '../domain';
import type { ContentError } from './errors';

/**
 * Archive state machine (Phase 1A §1.5). `empty` means discovery completed and
 * genuinely found nothing; it is never used for a failed or partial discovery.
 */
export type ArchiveStatus =
  'loading' | 'ready' | 'empty' | 'partial' | 'stale' | 'unavailable' | 'error';

export type ArchiveSource = 'catalog' | 'fallback' | 'none';

export interface ArchiveDiagnostic {
  readonly code: string;
  readonly level: 'info' | 'warning' | 'error';
  readonly message: string;
}

export interface ArchiveSnapshot {
  readonly status: ArchiveStatus;
  readonly source: ArchiveSource;
  readonly listings: readonly CatalogListing[];
  readonly taxonomy: {
    readonly categories: readonly TaxonomyReference[];
    readonly tags: readonly TaxonomyReference[];
  };
  readonly compiledAt: number | null;
  readonly stale: boolean;
  /** True when coverage cannot be established as complete. */
  readonly partial: boolean;
  readonly message: string | null;
  readonly error: ContentError | null;
  readonly diagnostics: readonly ArchiveDiagnostic[];
}

export type DetailStatus = 'ready' | 'withdrawn' | 'missing' | 'invalid' | 'error' | 'unavailable';

export interface EntityDetailResult {
  readonly status: DetailStatus;
  readonly entity: ShadowArchiveEntity | null;
  readonly error: ContentError | null;
}
