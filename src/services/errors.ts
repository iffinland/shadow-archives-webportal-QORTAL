import { QortalBridgeError } from '../qortal/bridge';

/**
 * Domain-level error taxonomy (Phase 2A task 19). UI states must be able to
 * distinguish these, so failures are never collapsed into "empty".
 */
export type ContentErrorKind =
  | 'bridge-unavailable'
  | 'publisher-unscoped'
  | 'network'
  | 'timeout'
  | 'rejected'
  | 'resource-missing'
  | 'malformed'
  | 'unsupported-schema'
  | 'oversized'
  | 'partial-catalog'
  | 'stale-catalog'
  | 'unknown';

export interface ContentErrorInit {
  readonly kind: ContentErrorKind;
  readonly message: string;
  readonly action?: string;
  readonly cause?: unknown;
}

export class ContentError extends Error {
  readonly kind: ContentErrorKind;
  readonly action: string | null;
  readonly cause: unknown;

  constructor(init: ContentErrorInit) {
    super(init.message);
    this.name = 'ContentError';
    this.kind = init.kind;
    this.action = init.action ?? null;
    this.cause = init.cause;
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown content error';
}

/** Normalize any thrown value into the domain error taxonomy. */
export function toContentError(error: unknown): ContentError {
  if (error instanceof ContentError) return error;
  if (error instanceof QortalBridgeError) {
    const kindMap: Record<QortalBridgeError['kind'], ContentErrorKind> = {
      unavailable: 'bridge-unavailable',
      timeout: 'timeout',
      rejected: 'rejected',
      malformed: 'malformed',
      error: 'network',
    };
    return new ContentError({
      kind: kindMap[error.kind],
      message: error.message,
      action: error.action,
      cause: error,
    });
  }
  return new ContentError({ kind: 'unknown', message: messageOf(error), cause: error });
}

export function contentErrorIsUnavailable(error: ContentError | null): boolean {
  return (
    error !== null && (error.kind === 'bridge-unavailable' || error.kind === 'publisher-unscoped')
  );
}
