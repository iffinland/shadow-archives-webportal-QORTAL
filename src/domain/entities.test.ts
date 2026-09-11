import { describe, expect, it } from 'vitest';

import { readTaxonomyLabels, validateEntityPayload, validateMediaReference } from './entities';
import {
  TEST_ALBUM_FIXTURE,
  TEST_BLOG_FIXTURE,
  TEST_BLOG_ID,
  TEST_ITEM_FIXTURE,
  TEST_VIDEO_FIXTURE,
} from '../test/fixtures/content';

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('validateMediaReference', () => {
  it('accepts an explicit service/name/identifier reference', () => {
    expect(
      validateMediaReference({
        service: 'IMAGE',
        name: 'Shadow Archives',
        identifier: 'saw_img_x',
      }),
    ).toEqual({ service: 'IMAGE', name: 'Shadow Archives', identifier: 'saw_img_x' });
  });

  it('rejects default (identifier-less) media references', () => {
    expect(validateMediaReference({ service: 'IMAGE', name: 'Shadow Archives' })).toBeNull();
    expect(
      validateMediaReference({ service: 'IMAGE', name: 'Shadow Archives', identifier: '' }),
    ).toBeNull();
  });

  it('rejects invalid services, whitespace identifiers and missing names', () => {
    expect(validateMediaReference({ service: 'image', name: 'n', identifier: 'a' })).toBeNull();
    expect(validateMediaReference({ service: 'IMAGE', name: '', identifier: 'a' })).toBeNull();
    expect(validateMediaReference({ service: 'IMAGE', name: 'n', identifier: 'a b' })).toBeNull();
    expect(validateMediaReference({ service: 'IMAGE', name: 'n', identifier: 'a/b' })).toBeNull();
  });
});

describe('readTaxonomyLabels', () => {
  it('defaults to an empty list and trims usable labels', () => {
    expect(readTaxonomyLabels(undefined, 'tags')).toEqual({ ok: true, value: [] });
    expect(readTaxonomyLabels(['  Field Notes  '], 'categories')).toEqual({
      ok: true,
      value: ['Field Notes'],
    });
  });

  it('rejects unbounded arrays and drops unusable entries', () => {
    expect(readTaxonomyLabels('not-array', 'tags').ok).toBe(false);
    expect(
      readTaxonomyLabels(
        Array.from({ length: 33 }, () => 'x'),
        'tags',
      ).ok,
    ).toBe(false);
    expect(readTaxonomyLabels(['ok', 5, ''], 'tags')).toEqual({ ok: true, value: ['ok'] });
  });
});

describe('validateEntityPayload', () => {
  it('validates each supported entity kind', () => {
    expect(validateEntityPayload(TEST_BLOG_FIXTURE).ok).toBe(true);
    expect(validateEntityPayload(TEST_VIDEO_FIXTURE).ok).toBe(true);
    expect(validateEntityPayload(TEST_ITEM_FIXTURE).ok).toBe(true);
    expect(validateEntityPayload(TEST_ALBUM_FIXTURE).ok).toBe(true);
  });

  it('rejects a non-object payload without throwing', () => {
    const result = validateEntityPayload('not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('not-an-object');
  });

  it('rejects an unsupported schemaVersion', () => {
    const result = validateEntityPayload({ ...clone(TEST_BLOG_FIXTURE), schemaVersion: 2 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('unsupported-schema');
  });

  it('rejects an unknown kind', () => {
    const payload = { ...clone(TEST_BLOG_FIXTURE), kind: 'audio' };
    const result = validateEntityPayload(payload);
    expect(result.ok).toBe(false);
  });

  it('rejects a kind that does not match the expected route kind', () => {
    const result = validateEntityPayload(clone(TEST_BLOG_FIXTURE), { expectedKind: 'video' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('invalid-value');
  });

  it('rejects an invalid stable id, state or timestamps', () => {
    expect(validateEntityPayload({ ...clone(TEST_BLOG_FIXTURE), id: 'short' }).ok).toBe(false);
    expect(validateEntityPayload({ ...clone(TEST_BLOG_FIXTURE), state: 'deleted' }).ok).toBe(false);
    expect(validateEntityPayload({ ...clone(TEST_BLOG_FIXTURE), createdAt: -1 }).ok).toBe(false);
    expect(validateEntityPayload({ ...clone(TEST_BLOG_FIXTURE), updatedAt: 1.5 }).ok).toBe(false);
  });

  it('never trusts a payload publisher field as authority data', () => {
    const result = validateEntityPayload({
      ...clone(TEST_BLOG_FIXTURE),
      publisher: 'someone-else',
    });
    // The field is carried only as an informational display hint.
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.publisher).toBe('someone-else');
  });

  it('rejects a partial blog payload missing required data', () => {
    const payload = clone(TEST_BLOG_FIXTURE) as Record<string, unknown>;
    delete (payload.data as Record<string, unknown>).body;
    expect(validateEntityPayload(payload).ok).toBe(false);
  });

  it('rejects a malformed rich-text body', () => {
    const payload = clone(TEST_BLOG_FIXTURE) as Record<string, unknown>;
    (payload.data as Record<string, unknown>).body = { format: 'html-v1', doc: {} };
    expect(validateEntityPayload(payload).ok).toBe(false);
  });

  it('rejects a video without a media reference', () => {
    const payload = clone(TEST_VIDEO_FIXTURE) as Record<string, unknown>;
    delete (payload.data as Record<string, unknown>).media;
    expect(validateEntityPayload(payload).ok).toBe(false);
  });

  it('rejects a gallery item whose albumId is not a stable id', () => {
    const payload = clone(TEST_ITEM_FIXTURE) as Record<string, unknown>;
    (payload.data as Record<string, unknown>).albumId = 'not-an-id';
    expect(validateEntityPayload(payload).ok).toBe(false);
  });

  it('rejects a blog payload whose embedded id disagrees with the identifier namespace', () => {
    // Sanity: the fixture id itself is a stable id, so the failure below is due
    // to the mismatched payload, not an unrelated validation error.
    expect(TEST_BLOG_ID).toHaveLength(12);
    const payload = clone(TEST_BLOG_FIXTURE) as Record<string, unknown>;
    (payload.data as Record<string, unknown>).slug = 'Bad Slug!';
    expect(validateEntityPayload(payload).ok).toBe(false);
  });
});
