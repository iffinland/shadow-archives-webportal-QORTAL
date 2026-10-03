/**
 * Shadow Archives owner About-page publication.
 *
 * The About page is a singleton, so this is the only module that turns an About
 * draft into a QDN write. It reuses the shared owner-write authority gate (a
 * local capability check plus a *fresh* ownership proof immediately before the
 * write), writes one DOCUMENT resource at the fixed `saw_about` identifier, then
 * performs a bounded read-back and only claims success when the served payload
 * matches. It never retries an ambiguous write.
 *
 * It is imported only from the lazy About-owner boundary: public visitors and
 * the startup graph never load it, and it is deliberately not re-exported from
 * `services/index.ts`.
 */

import {
  ABOUT_PAGE_IDENTIFIER,
  ABOUT_PAGE_SERVICE,
  validateAboutPagePayload,
} from '../domain/aboutPage';
import { LIMITS, SUPPORTED_SCHEMA_VERSION } from '../domain/constants';
import { richTextToPlainText } from '../domain/richTextMarkdown';
import type { RichTextDocument } from '../domain/types';
import {
  bridgePublishPort,
  type PublishAttempt,
  type PublishFailure,
  type PublishPort,
  type PublishSubmission,
} from '../qortal/publish';
import { utf8ToBase64 } from './base64';
import { getContentCache, type ContentCache } from './cache';
import { invalidateAboutCache } from './aboutRepository';
import { findExactResource } from './identity';
import { authorityFailure, authorityFreshFailure, type OwnerWriteContext } from './ownerAuthority';
import { bridgeQdnReadPort, parseJsonPayload, type QdnReadPort } from './qdnReader';

// Re-exported so the lazy About-owner modal imports one module.
export type { OwnerWriteContext } from './ownerAuthority';

export interface AboutPublishDraft {
  /** Canonical body (owner decision D4: `tiptap-json-v1`). */
  readonly body: RichTextDocument;
}

export type AboutPublicationStatus = 'published' | 'submitted-unconfirmed' | 'ambiguous' | 'failed';

export interface AboutPublicationResult {
  readonly status: AboutPublicationStatus;
  readonly message: string;
  readonly identifier: string;
  readonly publisherName: string;
  readonly submission: PublishSubmission | null;
  readonly failures: readonly PublishFailure[];
  /** True only when a bounded read after submission served the exact payload. */
  readonly entityConfirmed: boolean;
  /** The exact payload written; enables strong readback verification. */
  readonly entityPayload: unknown;
}

export type AboutPublishErrorCode =
  | 'not-hosted'
  | 'not-owner'
  | 'authority-unresolved'
  | 'authority-changed'
  | 'invalid-input'
  | 'payload-too-large'
  | 'unexpected';

export class AboutPublishError extends Error {
  readonly code: AboutPublishErrorCode;

  constructor(code: AboutPublishErrorCode, message: string) {
    super(message);
    this.name = 'AboutPublishError';
    this.code = code;
  }
}

export interface AboutPublishDeps {
  readonly reader: QdnReadPort;
  readonly writer: PublishPort;
  readonly cache: ContentCache;
  readonly now: () => number;
}

export function createAboutPublishDeps(
  overrides: Partial<AboutPublishDeps> = {},
): AboutPublishDeps {
  return {
    reader: overrides.reader ?? bridgeQdnReadPort,
    writer: overrides.writer ?? bridgePublishPort,
    cache: overrides.cache ?? getContentCache(),
    now: overrides.now ?? (() => Date.now()),
  };
}

function authorityCheck(ctx: OwnerWriteContext, publisherName: string): void {
  const failure = authorityFailure(ctx, publisherName, 'About page');
  if (failure) throw new AboutPublishError(failure.code, failure.message);
}

async function documentData64(payload: unknown, capBytes: number): Promise<string> {
  const text = JSON.stringify(payload);
  const byteLength = new TextEncoder().encode(text).length;
  if (byteLength > capBytes) {
    throw new AboutPublishError(
      'payload-too-large',
      `The About page content is ${byteLength} bytes, above the ${capBytes}-byte limit.`,
    );
  }
  return utf8ToBase64(text);
}

/** Bounded readback: true only when the served payload equals the intended one. */
async function confirmAboutPage(
  deps: AboutPublishDeps,
  publisherName: string,
  entityPayload: unknown,
): Promise<boolean> {
  try {
    const text = await deps.reader.fetchText(
      { service: ABOUT_PAGE_SERVICE, name: publisherName, identifier: ABOUT_PAGE_IDENTIFIER },
      { timeoutMs: 15_000 },
    );
    const parsed = parseJsonPayload(text, LIMITS.entityBytes);
    if (!parsed.ok) return false;
    const validated = validateAboutPagePayload(parsed.value);
    if (!validated.ok) return false;
    return JSON.stringify(validated.value) === JSON.stringify(entityPayload);
  } catch {
    return false;
  }
}

/**
 * Publish (or replace) the singleton About page.
 *
 * Ordering: validate the draft, take the local capability gate, build and
 * validate the payload, take the *fresh* ownership proof immediately before the
 * write, write exactly one resource, invalidate the read cache, then re-read the
 * served content. A timeout is reported as ambiguous and never retried here.
 */
export async function publishAboutPage(
  ctx: OwnerWriteContext,
  draft: AboutPublishDraft,
  deps: AboutPublishDeps = createAboutPublishDeps(),
): Promise<AboutPublicationResult> {
  const publisherName = ctx.environment.publisherName;
  if (!publisherName) {
    throw new AboutPublishError('authority-unresolved', 'No publishing name is available.');
  }
  if (!draft.body || typeof draft.body !== 'object') {
    throw new AboutPublishError('invalid-input', 'The About page body is missing.');
  }

  const bodyText = richTextToPlainText(draft.body);
  if (bodyText.trim().length === 0) {
    throw new AboutPublishError('invalid-input', 'Write the About page text before publishing.');
  }

  // Pre-write capability gate: nothing is prepared or encoded until the session
  // is a verified owner in a real host.
  authorityCheck(ctx, publisherName);

  const payload = {
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    kind: 'about-page' as const,
    publisher: publisherName,
    updatedAt: deps.now(),
    data: { body: draft.body, bodyText },
  };
  const validated = validateAboutPagePayload(payload);
  if (!validated.ok) {
    throw new AboutPublishError(
      'invalid-input',
      `The About page payload is invalid: ${validated.message}`,
    );
  }
  const entityPayload = validated.value;
  const data64 = await documentData64(entityPayload, LIMITS.entityBytes);

  // Fresh ownership proof immediately before the write: a name transfer between
  // the capability check above and this point blocks the write.
  const fresh = await authorityFreshFailure(ctx, publisherName, 'About page');
  if (fresh) throw new AboutPublishError(fresh.code, fresh.message);

  const attempt: PublishAttempt = await deps.writer.publishResource({
    service: ABOUT_PAGE_SERVICE,
    name: publisherName,
    identifier: ABOUT_PAGE_IDENTIFIER,
    data64,
    filename: `${ABOUT_PAGE_IDENTIFIER}.json`,
    title: 'Shadow Archives — About',
    description: 'About page content for Shadow Archives.',
  });

  await invalidateAboutCache(deps.cache, publisherName);

  const submission =
    attempt.kind === 'submitted' || attempt.kind === 'partial'
      ? (attempt.submissions[0] ?? null)
      : null;
  const failures = attempt.kind === 'partial' || attempt.kind === 'failed' ? attempt.failures : [];

  if (attempt.kind === 'ambiguous') {
    return {
      status: 'ambiguous',
      message:
        'The submission timed out. The host may still have published it, so nothing was retried automatically. Verify before saving again.',
      identifier: ABOUT_PAGE_IDENTIFIER,
      publisherName,
      submission,
      failures,
      entityConfirmed: false,
      entityPayload,
    };
  }

  if (attempt.kind !== 'submitted') {
    return {
      status: 'failed',
      message:
        attempt.kind === 'partial'
          ? 'The host reported the About page as not published. Nothing is being claimed.'
          : 'The About page was not published.',
      identifier: ABOUT_PAGE_IDENTIFIER,
      publisherName,
      submission,
      failures,
      entityConfirmed: false,
      entityPayload,
    };
  }

  const entityConfirmed = await confirmAboutPage(deps, publisherName, entityPayload);

  return {
    status: entityConfirmed ? 'published' : 'submitted-unconfirmed',
    message: entityConfirmed
      ? 'Published. The About page now serves the text you saved.'
      : 'Submitted. The host acknowledged the write, but the served content could not be confirmed by a read-back yet.',
    identifier: ABOUT_PAGE_IDENTIFIER,
    publisherName,
    submission,
    failures,
    entityConfirmed,
    entityPayload,
  };
}

export type AboutVerifyStatus = 'confirmed' | 'missing' | 'unconfirmed' | 'error';

export interface AboutVerifyResult {
  readonly status: AboutVerifyStatus;
  readonly present: boolean | null;
  readonly contentMatches: boolean | null;
  readonly message: string;
}

/**
 * Read-only verification of the served About resource against an expected
 * payload; used by the owner UI after a publish and on demand.
 */
export async function verifyAboutPublication(
  publisherName: string,
  expectedPayload: unknown,
  deps: AboutPublishDeps = createAboutPublishDeps(),
): Promise<AboutVerifyResult> {
  const lookup = await findExactResource(deps.reader, {
    service: ABOUT_PAGE_SERVICE,
    name: publisherName,
    identifier: ABOUT_PAGE_IDENTIFIER,
  });
  if (lookup.kind === 'error') {
    return {
      status: 'error',
      present: null,
      contentMatches: null,
      message: 'The QDN search needed for verification failed.',
    };
  }
  if (lookup.kind === 'missing') {
    return {
      status: 'missing',
      present: false,
      contentMatches: null,
      message: 'No About page resource is served under this publishing name.',
    };
  }

  try {
    const text = await deps.reader.fetchText(
      { service: ABOUT_PAGE_SERVICE, name: publisherName, identifier: ABOUT_PAGE_IDENTIFIER },
      { timeoutMs: 15_000 },
    );
    const parsed = parseJsonPayload(text, LIMITS.entityBytes);
    if (!parsed.ok) {
      return {
        status: 'unconfirmed',
        present: true,
        contentMatches: false,
        message: 'A resource is present but its payload could not be read.',
      };
    }
    const validated = validateAboutPagePayload(parsed.value);
    const contentMatches =
      validated.ok && JSON.stringify(validated.value) === JSON.stringify(expectedPayload);
    return {
      status: contentMatches ? 'confirmed' : 'unconfirmed',
      present: true,
      contentMatches,
      message: contentMatches
        ? 'The served About page matches the payload that was written.'
        : 'A resource is present but it does not match the payload that was written.',
    };
  } catch {
    return {
      status: 'error',
      present: null,
      contentMatches: null,
      message: 'The served About resource could not be read for verification.',
    };
  }
}
