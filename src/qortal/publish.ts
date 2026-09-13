/**
 * Verified QDN write mechanics.
 *
 * Source of truth (re-verified 2026-09-12 against the pinned upstream revisions
 * in the workspace standard):
 * - Core `108bf191` (v6.1.9): `q-apps.js` forwards the whole flat request object
 *   to the host for `PUBLISH_QDN_RESOURCE` / `PUBLISH_MULTIPLE_QDN_RESOURCES`
 *   and gives both a one-hour default timeout (proof-of-work).
 * - Hub `12a573b2` (`src/qortal/get.ts`, `src/hooks/useQortalMessageListener.tsx`):
 *   the payload is the flat request object; accepted fields are `service`,
 *   `name`, `identifier`, `data64`/`base64`/`file`/`blob`, `filename`,
 *   `title`, `description`, `category`, `tags` (or `tag1`..`tag5`) and
 *   `isMultiFileZip`. The Hub substitutes `'default'` when `identifier` is null,
 *   asks for one permission dialog per call, and returns the raw
 *   `/transactions/process` result for a single publish. For a grouped publish it
 *   publishes each resource sequentially (one second apart) and, when any of them
 *   fails, rejects with a structured `unsuccessfulPublishes` list — the
 *   successful resources are still published, so the result is a genuine partial
 *   success, not a rollback.
 *
 * This module is the only place allowed to call the publish actions. It is
 * deliberately NOT re-exported from `qortal/index.ts` so it stays out of the
 * visitor startup graph; the owner Gallery boundary imports it directly.
 */

import { QortalBridgeError, request, type RequestOptions } from './bridge';
import type { QortalWriteActionName } from './actions';
import { isRecord } from '../domain/validation';

/** Core/Hub default timeout for a single `PUBLISH_QDN_RESOURCE` (proof-of-work). */
export const PUBLISH_REQUEST_TIMEOUT_MS = 60 * 60 * 1000;

/** Hub's grouped-publish timeout budget: 30 minutes per resource. */
export const PUBLISH_MULTIPLE_TIMEOUT_MS_PER_RESOURCE = 30 * 60 * 1000;

/** Small buffer so the host's own timeout surfaces before ours does. */
const TIMEOUT_BUFFER_MS = 60 * 1000;

/**
 * One resource to publish, using the exact Hub payload field names.
 *
 * Exactly one of `data64` / `file` must be supplied. `file` passes raw bytes to
 * the host, which base64-encodes them itself (verified: Hub `12a573b2`
 * `src/qortal/get.ts` reads `data.file || data.blob`, then
 * `publishData({ data: data64 ? data64 : file })`). Large media MUST use `file`
 * so the app never materialises a second base64 copy of the bytes in its own
 * heap. `q-apps.js` forwards the request object to the host by structured clone
 * (`parent.postMessage(event.data, …)`), so a `File`/`Blob` survives the hop.
 */
export interface PublishResourceInput {
  readonly service: string;
  /** `null`/omitted publishes the default (identifier-less) resource. */
  readonly identifier?: string | null;
  /**
   * Registered publishing name. Shadow Archives always sends the name derived
   * from `_qdnName` so a write can never silently target another owned name.
   */
  readonly name: string;
  /** Base64-encoded resource bytes (small payloads). */
  readonly data64?: string;
  /** Raw bytes; the host base64-encodes them. Mutually exclusive with `data64`. */
  readonly file?: Blob;
  readonly filename?: string;
  readonly title?: string;
  readonly description?: string;
  /** Mirrored Core metadata tags (max 5, each <= 20 chars; filtered by the caller). */
  readonly tags?: readonly string[];
}

/** A resolved publish acknowledgment. `signature` is a submission, not a confirmation. */
export interface PublishSubmission {
  readonly service: string;
  readonly identifier: string | null;
  readonly name: string;
  readonly signature: string | null;
  /** Raw host result, retained for diagnostics without secrets. */
  readonly raw: unknown;
}

/** One resource the host reported as not published. */
export interface PublishFailure {
  readonly service: string;
  readonly identifier: string | null;
  readonly name: string | null;
  readonly reason: string;
}

/**
 * Result of one publish call.
 *
 * - `submitted` — the host returned a submission for every requested resource.
 * - `partial` — grouped publish: some resources were published, some were not.
 * - `ambiguous` — the call timed out; submission state is unknown and MUST NOT
 *   be retried automatically.
 * - `failed` — the call failed before any publish was acknowledged.
 */
export type PublishAttempt =
  | { readonly kind: 'submitted'; readonly submissions: readonly PublishSubmission[] }
  | {
      readonly kind: 'partial';
      readonly submissions: readonly PublishSubmission[];
      readonly failures: readonly PublishFailure[];
    }
  | { readonly kind: 'ambiguous'; readonly error: QortalBridgeError }
  | {
      readonly kind: 'failed';
      readonly error: QortalBridgeError;
      readonly failures: readonly PublishFailure[];
    };

/** The write boundary the services depend on; tests inject a fake. */
export interface PublishPort {
  publishResource(
    resource: PublishResourceInput,
    options?: RequestOptions,
  ): Promise<PublishAttempt>;
  publishResources(
    resources: readonly PublishResourceInput[],
    options?: RequestOptions,
  ): Promise<PublishAttempt>;
}

function toBridgePayload(resource: PublishResourceInput): Record<string, unknown> {
  const hasData = typeof resource.data64 === 'string' && resource.data64.length > 0;
  const hasFile = resource.file !== undefined && resource.file !== null;
  if (hasData === hasFile) {
    throw new Error('A publish resource needs exactly one of data64 or file');
  }
  const payload: Record<string, unknown> = {
    service: resource.service,
    name: resource.name,
  };
  if (hasFile) payload.file = resource.file;
  else payload.data64 = resource.data64;
  if (resource.identifier) payload.identifier = resource.identifier;
  if (resource.filename) payload.filename = resource.filename;
  if (resource.title) payload.title = resource.title;
  if (resource.description) payload.description = resource.description;
  if (resource.tags && resource.tags.length > 0) payload.tags = [...resource.tags];
  return payload;
}

function readSignature(raw: unknown): string | null {
  if (!isRecord(raw)) return null;
  const signature = raw.signature;
  return typeof signature === 'string' && signature.length > 0 ? signature : null;
}

/**
 * A `PUBLISH_QDN_RESOURCE` result resolves the raw `/transactions/process`
 * transaction JSON (an object with `signature`). Be defensive: an unknown object
 * still counts as a submission acknowledgment only when a signature is present.
 */
function submissionFrom(raw: unknown, resource: PublishResourceInput): PublishSubmission {
  return {
    service: resource.service,
    identifier: resource.identifier ?? null,
    name: resource.name,
    signature: readSignature(raw),
    raw,
  };
}

function readUnsuccessfulPublishes(detail: unknown): PublishFailure[] {
  if (!isRecord(detail)) return [];
  const errorField = detail.error;
  if (!isRecord(errorField)) return [];
  const list = errorField.unsuccessfulPublishes;
  if (!Array.isArray(list)) return [];

  const failures: PublishFailure[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const service = typeof entry.service === 'string' ? entry.service : '';
    const identifier = typeof entry.identifier === 'string' ? entry.identifier : null;
    const name = typeof entry.name === 'string' ? entry.name : null;
    const reason = typeof entry.reason === 'string' ? entry.reason : 'Publish failed';
    failures.push({ service, identifier, name, reason });
  }
  return failures;
}

function isTimeout(error: QortalBridgeError): boolean {
  return error.kind === 'timeout';
}

function failureFor(resource: PublishResourceInput, error: QortalBridgeError): PublishFailure {
  return {
    service: resource.service,
    identifier: resource.identifier ?? null,
    name: resource.name,
    reason: error.message,
  };
}

async function publishCall(
  action: QortalWriteActionName,
  buildParams: (payloads: readonly Record<string, unknown>[]) => Record<string, unknown>,
  resources: readonly PublishResourceInput[],
  timeoutMs: number,
): Promise<PublishAttempt> {
  try {
    // Built inside the async body so a malformed input rejects the promise
    // instead of throwing synchronously out of the port.
    const params = buildParams(resources.map(toBridgePayload));
    const raw = await request<unknown>(action, params, { timeoutMs });
    const list = Array.isArray(raw) ? raw : [raw];
    const submissions = list.map((entry, index) => {
      const resource = resources[index] ?? resources[resources.length - 1];
      return submissionFrom(entry, resource);
    });
    return { kind: 'submitted', submissions };
  } catch (error) {
    const bridgeError =
      error instanceof QortalBridgeError
        ? error
        : new QortalBridgeError('error', 'Publish request failed', action, error);

    if (isTimeout(bridgeError)) return { kind: 'ambiguous', error: bridgeError };

    const failures = readUnsuccessfulPublishes(bridgeError.detail);
    if (failures.length > 0) {
      const failedCount = failures.length;
      if (failedCount >= resources.length) {
        return { kind: 'failed', error: bridgeError, failures };
      }
      const failedIdentifiers = new Set(
        failures.map((failure) => `${failure.service}|${failure.identifier ?? ''}`),
      );
      const submissions = resources
        .filter(
          (resource) => !failedIdentifiers.has(`${resource.service}|${resource.identifier ?? ''}`),
        )
        .map<PublishSubmission>((resource) => ({
          service: resource.service,
          identifier: resource.identifier ?? null,
          name: resource.name,
          signature: null,
          raw: null,
        }));
      return { kind: 'partial', submissions, failures };
    }

    return {
      kind: 'failed',
      error: bridgeError,
      failures: [failureFor(resources[0], bridgeError)],
    };
  }
}

/** Real bridge implementation of the write port. */
export const bridgePublishPort: PublishPort = {
  publishResource(resource, options) {
    return publishCall(
      'PUBLISH_QDN_RESOURCE',
      (payloads) => ({ ...payloads[0] }),
      [resource],
      options?.timeoutMs ?? PUBLISH_REQUEST_TIMEOUT_MS,
    );
  },

  publishResources(resources, options) {
    if (resources.length === 0) {
      throw new Error('publishResources requires at least one resource');
    }
    return publishCall(
      'PUBLISH_MULTIPLE_QDN_RESOURCES',
      (payloads) => ({ resources: [...payloads] }),
      resources,
      options?.timeoutMs ??
        resources.length * PUBLISH_MULTIPLE_TIMEOUT_MS_PER_RESOURCE + TIMEOUT_BUFFER_MS,
    );
  },
};
