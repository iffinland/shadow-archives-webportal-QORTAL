/**
 * TEST-ONLY fake QDN transport.
 *
 * Records every request so tests can assert the exact bridge contract that the
 * service layer emits (field names, pagination bounds, `mode`, concurrency).
 */
import type { QdnResourceRef, QdnSearchRequest, RequestOptions } from '../../qortal';
import type { QdnReadPort } from '../../services/qdnReader';

export type SearchResponder = (
  request: QdnSearchRequest,
  options?: RequestOptions,
) => unknown[] | Promise<unknown[]>;

export type FetchResponder = (
  ref: QdnResourceRef,
  options?: RequestOptions,
) => string | Promise<string>;

export interface RecordingReader extends QdnReadPort {
  readonly searches: QdnSearchRequest[];
  readonly fetches: QdnResourceRef[];
}

export function createRecordingReader(
  search: SearchResponder,
  fetchText: FetchResponder,
): RecordingReader {
  const searches: QdnSearchRequest[] = [];
  const fetches: QdnResourceRef[] = [];
  return {
    searches,
    fetches,
    async search(request, options) {
      searches.push(request);
      return search(request, options);
    },
    async fetchText(ref, options) {
      fetches.push(ref);
      return fetchText(ref, options);
    },
  };
}

/** A search hit in the shape the node returns. */
export function makeSearchHit(
  service: string,
  name: string,
  identifier: string | null,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    name,
    service,
    identifier,
    latestSignature: 'test-signature',
    status: 'READY',
    metadata: null,
    size: 1024,
    created: 1_700_000_000_000,
    updated: 1_700_000_500_000,
    ...overrides,
  };
}
