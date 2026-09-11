import { describe, expect, it } from 'vitest';

import { normalizeSearchHit, normalizeSearchHits, parseJsonPayload } from './qdnReader';

describe('normalizeSearchHit', () => {
  it('normalizes a full node search result', () => {
    const hit = normalizeSearchHit({
      name: 'Shadow Archives',
      service: 'DOCUMENT',
      identifier: 'saw_post_abc',
      created: 100,
      updated: 200,
      size: 512,
      status: 'READY',
      metadata: {
        title: 'T',
        description: 'D',
        tags: ['a', 'b'],
        category: 'c',
        mimeType: 'text/plain',
      },
    });
    expect(hit).toEqual({
      service: 'DOCUMENT',
      name: 'Shadow Archives',
      identifier: 'saw_post_abc',
      created: 100,
      updated: 200,
      size: 512,
      status: 'READY',
      metadata: {
        title: 'T',
        description: 'D',
        tags: ['a', 'b'],
        category: 'c',
        mimeType: 'text/plain',
      },
    });
  });

  it('preserves a null identifier to mean the default resource', () => {
    const hit = normalizeSearchHit({ name: 'N', service: 'DOCUMENT', identifier: null });
    expect(hit?.identifier).toBeNull();
  });

  it('accepts an object status shape', () => {
    const hit = normalizeSearchHit({
      name: 'N',
      service: 'DOCUMENT',
      status: { status: 'PUBLISHED' },
    });
    expect(hit?.status).toBe('PUBLISHED');
  });

  it('returns null when the identity is unusable', () => {
    expect(normalizeSearchHit(null)).toBeNull();
    expect(normalizeSearchHit({ service: 'DOCUMENT' })).toBeNull();
    expect(normalizeSearchHit({ name: 'N' })).toBeNull();
    expect(normalizeSearchHit('nope')).toBeNull();
  });

  it('drops metadata when nothing usable is present', () => {
    expect(
      normalizeSearchHit({ name: 'N', service: 'DOCUMENT', metadata: {} })?.metadata,
    ).toBeNull();
    expect(
      normalizeSearchHit({ name: 'N', service: 'DOCUMENT', metadata: 'x' })?.metadata,
    ).toBeNull();
  });
});

describe('normalizeSearchHits', () => {
  it('counts rejected items without failing the batch', () => {
    const { hits, rejected } = normalizeSearchHits([
      { name: 'N', service: 'DOCUMENT' },
      null,
      { service: 'DOCUMENT' },
      'nope',
    ]);
    expect(hits).toHaveLength(1);
    expect(rejected).toBe(3);
  });
});

describe('parseJsonPayload', () => {
  it('parses valid JSON', () => {
    const result = parseJsonPayload('{"a":1}', 100);
    expect(result).toEqual({ ok: true, value: { a: 1 } });
  });

  it('rejects oversized, empty and malformed payloads without throwing', () => {
    const oversized = parseJsonPayload('x'.repeat(11), 10);
    expect(oversized.ok).toBe(false);
    if (!oversized.ok) expect(oversized.error.kind).toBe('oversized');

    const empty = parseJsonPayload('   ', 100);
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.error.kind).toBe('malformed');

    const malformed = parseJsonPayload('{not json', 100);
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error.kind).toBe('malformed');
  });
});
