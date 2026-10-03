import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { richTextToPlainText } from '../domain/richTextMarkdown';
import type { RichTextDocument } from '../domain/types';
import { resetAuthSession } from '../qortal/auth';
import { QortalBridgeError } from '../qortal/bridge';
import type {
  PublishAttempt,
  PublishPort,
  PublishResourceInput,
  PublishSubmission,
} from '../qortal/publish';
import { makeEnvironment } from '../test/environment';
import type { CachePutOptions, CacheRecord, ContentCache } from './cache';
import type { QdnResourceRef } from '../qortal';
import type { QdnReadPort } from './qdnReader';
import {
  AboutPublishError,
  createAboutPublishDeps,
  publishAboutPage,
  verifyAboutPublication,
  type AboutPublishDeps,
  type OwnerWriteContext,
} from './aboutPublishService';

const OWNER = 'QPw4vnk5CBDWkgdXB4vUXCc4DXGEjHVxCA';
const OTHER = 'QOtherOwnerAddressForTests000000000000';
const PUBLISHER = 'Shadow Archives';
const NOW = 1_700_000_000_000;

const HOSTED = makeEnvironment({
  bridgeAvailable: true,
  isHosted: true,
  context: 'app',
  service: 'APP',
  name: 'Shadow%20Archives',
  publisherName: PUBLISHER,
});

function ownerContext(overrides: Partial<OwnerWriteContext> = {}): OwnerWriteContext {
  return {
    capability: 'owner',
    account: { address: OWNER, publicKey: 'PUBLIC_KEY' },
    environment: HOSTED,
    ...overrides,
  };
}

function body(text = 'The archive remembers.'): RichTextDocument {
  return {
    format: 'tiptap-json-v1',
    doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  };
}

/** Installs a bridge that only answers the fresh-authority `GET_NAME_DATA` read. */
function installNameData(owner = OWNER): ReturnType<typeof vi.fn> {
  const mock = vi.fn((payload: Record<string, unknown>) => {
    if (payload.action === 'GET_NAME_DATA') {
      return Promise.resolve({ name: PUBLISHER, owner });
    }
    return Promise.reject(new Error(`Unexpected action: ${String(payload.action)}`));
  });
  Object.defineProperty(window, 'qortalRequest', {
    configurable: true,
    writable: true,
    value: mock,
  });
  return mock;
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

interface WriterFake {
  readonly port: PublishPort;
  readonly calls: readonly PublishResourceInput[][];
}

function submissionFor(resource: PublishResourceInput): PublishSubmission {
  return {
    service: resource.service,
    identifier: resource.identifier ?? null,
    name: resource.name,
    signature: 'about-signature',
    raw: { signature: 'about-signature' },
  };
}

function writerFake(
  attemptFor: (resources: readonly PublishResourceInput[]) => PublishAttempt,
): WriterFake {
  const calls: PublishResourceInput[][] = [];
  return {
    calls,
    port: {
      async publishResource(resource) {
        calls.push([resource]);
        return attemptFor([resource]);
      },
      async publishResources(resources) {
        calls.push([...resources]);
        return attemptFor(resources);
      },
    },
  };
}

function submittedAttempt(resources: readonly PublishResourceInput[]): PublishAttempt {
  return { kind: 'submitted', submissions: resources.map(submissionFor) };
}

function readerReturning(text: string | null): { reader: QdnReadPort; fetches: QdnResourceRef[] } {
  const fetches: QdnResourceRef[] = [];
  return {
    fetches,
    reader: {
      async search() {
        if (text === null) return [];
        return [
          {
            service: 'DOCUMENT',
            name: PUBLISHER,
            identifier: 'saw_about',
            created: 1,
            updated: 1,
            size: 128,
            status: 'READY',
            metadata: null,
          },
        ];
      },
      async fetchText(ref) {
        fetches.push(ref);
        if (text === null) throw new QortalBridgeError('error', 'not found', 'FETCH_QDN_RESOURCE');
        return text;
      },
    },
  };
}

function expectedPayload(doc: RichTextDocument) {
  return {
    schemaVersion: 1,
    kind: 'about-page',
    publisher: PUBLISHER,
    updatedAt: NOW,
    data: { body: doc, bodyText: richTextToPlainText(doc) },
  };
}

beforeEach(() => {
  resetAuthSession();
});

afterEach(() => {
  resetAuthSession();
  Reflect.deleteProperty(window, 'qortalRequest');
});

describe('publishAboutPage', () => {
  it('refuses a non-owner before any write', async () => {
    const writer = writerFake(submittedAttempt);
    await expect(
      publishAboutPage(
        ownerContext({ capability: 'visitor' }),
        { body: body() },
        {
          reader: readerReturning(null).reader,
          writer: writer.port,
          cache: memoryCache(),
          now: () => NOW,
        },
      ),
    ).rejects.toMatchObject({ code: 'not-owner' });
    expect(writer.calls).toHaveLength(0);
  });

  it('refuses an empty body before any write', async () => {
    installNameData();
    const writer = writerFake(submittedAttempt);
    await expect(
      publishAboutPage(
        ownerContext(),
        { body: body('   ') },
        {
          reader: readerReturning(null).reader,
          writer: writer.port,
          cache: memoryCache(),
          now: () => NOW,
        },
      ),
    ).rejects.toBeInstanceOf(AboutPublishError);
    expect(writer.calls).toHaveLength(0);
  });

  it('re-verifies ownership immediately before the write and blocks a name transfer', async () => {
    // The local capability says owner, but the live name lookup now names another
    // owner: the write must be blocked and nothing may be published.
    installNameData(OTHER);
    const writer = writerFake(submittedAttempt);
    await expect(
      publishAboutPage(
        ownerContext(),
        { body: body() },
        {
          reader: readerReturning(null).reader,
          writer: writer.port,
          cache: memoryCache(),
          now: () => NOW,
        },
      ),
    ).rejects.toMatchObject({ code: 'authority-changed' });
    expect(writer.calls).toHaveLength(0);
  });

  it('writes one DOCUMENT at saw_about, re-reads it, and only then claims success', async () => {
    installNameData();
    const doc = body();
    const writer = writerFake(submittedAttempt);
    const { reader, fetches } = readerReturning(JSON.stringify(expectedPayload(doc)));

    const deps: AboutPublishDeps = {
      reader,
      writer: writer.port,
      cache: memoryCache(),
      now: () => NOW,
    };
    const result = await publishAboutPage(ownerContext(), { body: doc }, deps);

    expect(result.status).toBe('published');
    expect(result.entityConfirmed).toBe(true);
    expect(result.identifier).toBe('saw_about');

    expect(writer.calls).toHaveLength(1);
    const resource = writer.calls[0][0];
    expect(resource).toMatchObject({
      service: 'DOCUMENT',
      name: PUBLISHER,
      identifier: 'saw_about',
    });
    expect(typeof resource.data64).toBe('string');
    expect(fetches[0]).toEqual({
      service: 'DOCUMENT',
      name: PUBLISHER,
      identifier: 'saw_about',
    });
  });

  it('reports unconfirmed (never success) when the read-back does not match', async () => {
    installNameData();
    const writer = writerFake(submittedAttempt);
    const { reader } = readerReturning(JSON.stringify(expectedPayload(body('different text'))));

    const result = await publishAboutPage(
      ownerContext(),
      { body: body() },
      {
        reader,
        writer: writer.port,
        cache: memoryCache(),
        now: () => NOW,
      },
    );

    expect(result.status).toBe('submitted-unconfirmed');
    expect(result.entityConfirmed).toBe(false);
  });

  it('reports an ambiguous submission truthfully and never retries', async () => {
    installNameData();
    const writer = writerFake(() => ({
      kind: 'ambiguous',
      error: new QortalBridgeError('timeout', 'timed out', 'PUBLISH_QDN_RESOURCE'),
    }));
    const { reader, fetches } = readerReturning(JSON.stringify(expectedPayload(body())));

    const result = await publishAboutPage(
      ownerContext(),
      { body: body() },
      {
        reader,
        writer: writer.port,
        cache: memoryCache(),
        now: () => NOW,
      },
    );

    expect(result.status).toBe('ambiguous');
    expect(result.entityConfirmed).toBe(false);
    expect(writer.calls).toHaveLength(1);
    expect(fetches).toHaveLength(0);
  });
});

describe('verifyAboutPublication', () => {
  it('confirms only when the served payload matches', async () => {
    const doc = body();
    const expected = expectedPayload(doc);
    const matching = readerReturning(JSON.stringify(expected));
    const confirmed = await verifyAboutPublication(PUBLISHER, expected, {
      reader: matching.reader,
      writer: writerFake(submittedAttempt).port,
      cache: memoryCache(),
      now: () => NOW,
    });
    expect(confirmed.status).toBe('confirmed');
  });

  it('reports missing when no About resource is served', async () => {
    const reader: QdnReadPort = {
      async search() {
        return [];
      },
      async fetchText() {
        throw new Error('unused');
      },
    };
    const result = await verifyAboutPublication(PUBLISHER, expectedPayload(body()), {
      reader,
      writer: writerFake(submittedAttempt).port,
      cache: memoryCache(),
      now: () => NOW,
    });
    expect(result.status).toBe('missing');
    expect(result.present).toBe(false);
  });
});

describe('createAboutPublishDeps', () => {
  it('applies overrides', () => {
    const deps = createAboutPublishDeps({ now: () => 123 });
    expect(deps.now()).toBe(123);
  });
});
