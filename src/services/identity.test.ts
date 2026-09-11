import { describe, expect, it } from 'vitest';

import {
  entityIdentifierMatches,
  entityIdentity,
  findExactResource,
  identityMatches,
} from './identity';
import type { QdnSearchHit } from './qdnReader';
import { createRecordingReader, makeSearchHit } from '../test/fixtures/qdn';

function hit(partial: Partial<QdnSearchHit>): QdnSearchHit {
  return {
    service: 'DOCUMENT',
    name: 'Shadow Archives',
    identifier: null,
    created: null,
    updated: null,
    size: null,
    status: null,
    metadata: null,
    ...partial,
  };
}

describe('identityMatches', () => {
  it('requires an exact service, name and identifier match', () => {
    expect(
      identityMatches(hit({ identifier: 'saw_post_abc' }), {
        service: 'DOCUMENT',
        name: 'Shadow Archives',
        identifier: 'saw_post_abc',
      }),
    ).toBe(true);
  });

  it('compares names case-insensitively (QDN names are case-insensitive)', () => {
    expect(
      identityMatches(hit({ name: 'shadow archives' }), {
        service: 'DOCUMENT',
        name: 'Shadow Archives',
        identifier: null,
      }),
    ).toBe(true);
  });

  it('rejects a substring/prefix collision and a different service', () => {
    expect(
      identityMatches(hit({ identifier: 'saw_post_abcdef' }), {
        service: 'DOCUMENT',
        name: 'Shadow Archives',
        identifier: 'saw_post_abc',
      }),
    ).toBe(false);
    expect(
      identityMatches(hit({ service: 'APP', identifier: 'saw_post_abc' }), {
        service: 'DOCUMENT',
        name: 'Shadow Archives',
        identifier: 'saw_post_abc',
      }),
    ).toBe(false);
  });

  it('treats a missing identifier as the default resource only when that is expected', () => {
    expect(
      identityMatches(hit({ identifier: null }), {
        service: 'DOCUMENT',
        name: 'Shadow Archives',
        identifier: null,
      }),
    ).toBe(true);
    expect(
      identityMatches(hit({ identifier: null }), {
        service: 'DOCUMENT',
        name: 'Shadow Archives',
        identifier: 'saw_post_abc',
      }),
    ).toBe(false);
  });
});

describe('findExactResource', () => {
  const expected = { service: 'DOCUMENT', name: 'Shadow Archives', identifier: 'saw_post_abc' };

  it('returns the exact match and ignores prefix collisions', async () => {
    const reader = createRecordingReader(
      () => [
        makeSearchHit('DOCUMENT', 'Shadow Archives', 'saw_post_abc_extra'),
        makeSearchHit('DOCUMENT', 'Shadow Archives', 'saw_post_abc'),
      ],
      () => '',
    );
    const lookup = await findExactResource(reader, expected);
    expect(lookup.kind).toBe('found');
    if (lookup.kind === 'found') expect(lookup.hit.identifier).toBe('saw_post_abc');
  });

  it('searches with exactMatchNames and mode ALL (not the LATEST default)', async () => {
    const reader = createRecordingReader(
      () => [],
      () => '',
    );
    await findExactResource(reader, expected);
    expect(reader.searches).toHaveLength(1);
    expect(reader.searches[0]).toMatchObject({
      service: 'DOCUMENT',
      name: 'Shadow Archives',
      identifier: 'saw_post_abc',
      exactMatchNames: true,
      mode: 'ALL',
    });
    expect(reader.searches[0]).not.toHaveProperty('defaultResource');
  });

  it('requests the default resource when the identifier is null', async () => {
    const reader = createRecordingReader(
      () => [],
      () => '',
    );
    await findExactResource(reader, { service: 'DOCUMENT', name: 'N', identifier: null });
    expect(reader.searches[0]).toMatchObject({ defaultResource: true });
    expect(reader.searches[0]).not.toHaveProperty('identifier');
  });

  it('distinguishes a missing resource from a failed search', async () => {
    const missing = await findExactResource(
      createRecordingReader(
        () => [],
        () => '',
      ),
      expected,
    );
    expect(missing.kind).toBe('missing');

    const failing = await findExactResource(
      createRecordingReader(
        () => {
          throw new Error('network down');
        },
        () => '',
      ),
      expected,
    );
    expect(failing.kind).toBe('error');
  });

  it('ignores a hit published under a different name', async () => {
    const reader = createRecordingReader(
      () => [makeSearchHit('DOCUMENT', 'Other Publisher', 'saw_post_abc')],
      () => '',
    );
    const lookup = await findExactResource(reader, expected);
    expect(lookup.kind).toBe('missing');
  });
});

describe('entityIdentity', () => {
  it('builds a DOCUMENT identity from the kind and stable id', () => {
    expect(entityIdentity('video', 'vid000000001', 'Shadow Archives')).toEqual({
      service: 'DOCUMENT',
      name: 'Shadow Archives',
      identifier: 'saw_vid_vid000000001',
    });
  });
});

describe('entityIdentifierMatches', () => {
  it('accepts only the exact kind/id identifier', () => {
    expect(entityIdentifierMatches('saw_post_abc123def456', 'blog-post', 'abc123def456')).toBe(
      true,
    );
    expect(entityIdentifierMatches('saw_post_abc123def456', 'video', 'abc123def456')).toBe(false);
    expect(entityIdentifierMatches('saw_post_abc123def456extra', 'blog-post', 'abc123def456')).toBe(
      false,
    );
  });
});
