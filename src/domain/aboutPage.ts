/**
 * Shadow Archives About-page content contract.
 *
 * The About page is a singleton page, not a discovered entity: it is never
 * listed or catalogued. It deliberately reuses the canonical rich-text model
 * (`tiptap-json-v1`, owner decision D4) at one fixed DOCUMENT identifier under
 * the app's own publishing name instead of adding a fifth entity kind or a
 * parallel CMS. The payload keeps the same schema-version/kind/publisher
 * envelope fields as entities so the read path stays fail-closed, and its body
 * is rendered through the exact same allowlisting renderer + DOMPurify boundary
 * as blog bodies.
 */

import { LIMITS, SUPPORTED_SCHEMA_VERSION } from './constants';
import { validateRichTextDocument } from './richText';
import type { RichTextDocument } from './types';
import {
  fail,
  isRecord,
  nonNegativeInteger,
  ok,
  optionalString,
  requireStringAllowEmpty,
  type ValidationResult,
} from './validation';

/** Singleton DOCUMENT resource: no stable id, no discovery, no catalog entry. */
export const ABOUT_PAGE_SERVICE = 'DOCUMENT';
export const ABOUT_PAGE_IDENTIFIER = 'saw_about';
export const ABOUT_PAGE_KIND = 'about-page';

export interface AboutPageData {
  readonly body: RichTextDocument;
  /** Normalized searchable plain text; derived from `body`, never trusted from a caller. */
  readonly bodyText: string;
}

export interface AboutPageDocument {
  readonly schemaVersion: number;
  readonly kind: 'about-page';
  /** Informational display hint only — never an authority test. */
  readonly publisher: string | null;
  readonly updatedAt: number;
  readonly data: AboutPageData;
}

/**
 * Validate one About-page payload. Never throws; malformed input returns a
 * failure so a corrupt resource is quarantined instead of rendered.
 */
export function validateAboutPagePayload(raw: unknown): ValidationResult<AboutPageDocument> {
  if (!isRecord(raw)) return fail('not-an-object', 'About page payload is not an object');
  if (raw.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    return fail('unsupported-schema', `Unsupported schemaVersion: ${String(raw.schemaVersion)}`);
  }
  if (raw.kind !== ABOUT_PAGE_KIND) {
    return fail('invalid-value', `Unknown About page kind: ${String(raw.kind)}`);
  }
  const updatedAt = nonNegativeInteger(raw.updatedAt);
  if (updatedAt === null) {
    return fail('invalid-value', 'About page updatedAt must be a non-negative integer');
  }
  if (!isRecord(raw.data)) return fail('invalid-type', 'About page data must be an object');

  const body = validateRichTextDocument(raw.data.body);
  if (!body.ok) return fail(body.code, body.message);
  const bodyText = requireStringAllowEmpty(raw.data.bodyText, LIMITS.bodyText);
  if (bodyText === null) return fail('invalid-value', 'About page bodyText is invalid');

  return ok({
    schemaVersion: SUPPORTED_SCHEMA_VERSION,
    kind: ABOUT_PAGE_KIND,
    publisher: optionalString(raw.publisher, LIMITS.name),
    updatedAt,
    data: { body: body.value, bodyText },
  });
}
