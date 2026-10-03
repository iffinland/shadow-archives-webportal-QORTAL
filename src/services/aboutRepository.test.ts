import { describe, expect, it } from 'vitest';

import { validateAboutPagePayload } from '../domain/aboutPage';
import type { RichTextDocument } from '../domain/types';
import { makeSearchHit } from '../test/fixtures/qdn';
import type { CachePutOptions, CacheRecord, ContentCache } from './cache';
import { aboutPageCacheKey, loadAboutPage } from './aboutRepository';
import type { PublisherScope } from './publisher';
import type { QdnResourceRef } from '../qortal';
import type { QdnReadPort } from './qdnReader';

const PUBLISHER = 'Shadow Archives';
const NOW = 1_700_000_000_000;

const SCOPE: PublisherScope = { scoped: true, name: PUBLISHER, service: 'APP' };

function body(text = 'Owner-written About text.'): RichTextDocument {
  return {
    format: 'tiptap-json-v1',
    doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  };
}

function payload(text?: string) {
  return {
    schemaVersion: 1,
    kind: 'about-page',
    publisher: PUBLISHER,
    updatedAt: NOW,
    data: { body: body(text), bodyText: text ?? 'Owner-written About text.' },
  };
}

function memoryCache(): ContentCache {
  const store = new Map<string, CacheRecord<unknown>>();
  return {
    async get<T>(key: string, version = 1) {
      const record = store.get(key) as CacheRecord<T> | undefined;
      if (!record || record.version !== version) return null;
      return record;
    },
    async put<T>(key: string, value: T, options: CachePutOptions) {
      store.set(key, {
        key,
        value,
        storedAt: NOW,
        expiresAt: NOW + options.ttlMs,
        version: options.version ?? 1,
      });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async clear() {
      store.clear();
    },
  };
}

function readerWith(raw: unknown | null): { reader: QdnReadPort; fetches: QdnResourceRef[] } {
  const fetches: QdnResourceRef[] = [];
  return {
    fetches,
    reader: {
      async search() {
        if (raw === null) return [];
        return [makeSearchHit('DOCUMENT', PUBLISHER, 'saw_about')];
      },
      async fetchText(ref) {
        fetches.push(ref);
        if (raw === null) throw new Error('missing');
        return typeof raw === 'string' ? raw : JSON.stringify(raw);
      },
    },
  };
}

describe('loadAboutPage', () => {
  it('returns unavailable without scope and issues no read', async () => {
    const { reader, fetches } = readerWith(payload());
    const result = await loadAboutPage(
      { scoped: false, reason: 'no-publisher-name' },
      { reader, cache: memoryCache(), now: NOW },
    );
    expect(result.status).toBe('unavailable');
    expect(result.document).toBeNull();
    expect(fetches).toHaveLength(0);
  });

  it('reads, validates and returns the served About document', async () => {
    const { reader, fetches } = readerWith(payload());
    const result = await loadAboutPage(SCOPE, { reader, cache: memoryCache(), now: NOW });

    expect(result.status).toBe('ready');
    expect(result.document?.data.body.doc).toBeDefined();
    expect(result.document?.data.bodyText).toBe('Owner-written About text.');
    expect(fetches[0]).toEqual({
      service: 'DOCUMENT',
      name: PUBLISHER,
      identifier: 'saw_about',
    });
  });

  it('distinguishes a genuinely missing resource from a read failure', async () => {
    const { reader } = readerWith(null);
    const missing = await loadAboutPage(SCOPE, { reader, cache: memoryCache(), now: NOW });
    expect(missing.status).toBe('missing');

    const erroring: QdnReadPort = {
      async search() {
        throw new Error('search failed');
      },
      async fetchText() {
        throw new Error('unused');
      },
    };
    const failed = await loadAboutPage(SCOPE, { reader: erroring, cache: memoryCache(), now: NOW });
    expect(failed.status).toBe('error');
  });

  it('quarantines a malformed payload instead of rendering it', async () => {
    const { reader } = readerWith({ schemaVersion: 1, kind: 'about-page', data: {} });
    const result = await loadAboutPage(SCOPE, { reader, cache: memoryCache(), now: NOW });
    expect(result.status).toBe('invalid');
    expect(result.document).toBeNull();
  });

  it('serves a fresh cached document without re-fetching', async () => {
    const cache = memoryCache();
    const first = readerWith(payload());
    await loadAboutPage(SCOPE, { reader: first.reader, cache, now: NOW });

    const second = readerWith(payload('Changed'));
    const result = await loadAboutPage(SCOPE, { reader: second.reader, cache, now: NOW + 1000 });

    expect(result.status).toBe('ready');
    expect(result.document?.data.bodyText).toBe('Owner-written About text.');
    expect(second.fetches).toHaveLength(0);
    expect(aboutPageCacheKey(PUBLISHER)).toBe('about:shadow archives');
  });

  it('round-trips through the validator (model-layer reload/read-back)', () => {
    const validated = validateAboutPagePayload(payload());
    expect(validated.ok).toBe(true);
    if (validated.ok) {
      expect(JSON.parse(JSON.stringify(validated.value))).toEqual(validated.value);
    }
  });
});
