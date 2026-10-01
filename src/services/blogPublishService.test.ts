import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeEnvironment } from '../test/environment';
import { validateCatalogManifest, validateCatalogPartition } from '../domain/catalog';
import { validateEntityPayload } from '../domain/entities';
import { resetAuthSession } from '../qortal/auth';
import { QortalBridgeError } from '../qortal/bridge';
import type {
  PublishAttempt,
  PublishFailure,
  PublishPort,
  PublishResourceInput,
  PublishSubmission,
} from '../qortal/publish';
import type { RichTextDocument } from '../domain/types';
import type { CachePutOptions, CacheRecord, ContentCache } from './cache';
import type { ImageProcessingDeps } from './imageProcessing';
import type { QdnReadPort, QdnSearchHit } from './qdnReader';
import { loadCatalog } from './catalogRepository';
import { loadEntityDetail } from './contentRepository';
import { isSubwireRenderableArticle } from './subwireArticleContract';
import { isQuitterRenderablePost, quitterPostIdentifier } from './quitterAnnouncementContract';
import {
  announceOnQuitter,
  blogSubwireIdentifier,
  BlogPublishError,
  createBlogPublishDeps,
  isSubwireArtifactOf,
  publishBlogPost,
  quitterAnnouncementIdOf,
  verifyBlogPublication,
  type BlogPublishDeps,
  type BlogPublishDraft,
  type OwnerWriteContext,
} from './blogPublishService';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const OWNER = 'QPw4vnk5CBDWkgdXB4vUXCc4DXGEjHVxCA';
const OTHER = 'QOtherAccountAddressForTests1234567890';
const PUBLISHER = 'Shadow Archives';
const FIXED_ID = 'abcdefghijkl';
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

const PNG_HEADER = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function coverFile(name = 'cover.png'): File {
  return new File([PNG_HEADER], name, { type: 'image/png' });
}

function bodyDocument(text = 'The archive remembers.'): RichTextDocument {
  return {
    format: 'tiptap-json-v1',
    doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
  };
}

function blogDraft(overrides: Partial<BlogPublishDraft> = {}): BlogPublishDraft {
  return {
    title: 'Uncovering the past',
    excerpt: 'How the archive survived the flood.',
    body: bodyDocument(),
    cover: coverFile(),
    categories: ['History'],
    tags: ['archive', 'qortal'],
    language: 'en',
    ...overrides,
  };
}

/** Deterministic cover deps: no canvas, no real decoding. */
function fakeImageDeps(): ImageProcessingDeps {
  return {
    async decode() {
      return { width: 1200, height: 800, close: () => undefined };
    },
    createCanvas(width, height) {
      const canvas = { width, height } as unknown as HTMLCanvasElement;
      const context = {
        clearRect: () => undefined,
        drawImage: () => undefined,
      } as unknown as CanvasRenderingContext2D;
      return { canvas, context };
    },
    async toBlob(canvas, type) {
      const target = canvas as unknown as { width: number; height: number };
      return new Blob([new Uint8Array(Math.max(64, Math.round(target.width / 4)))], { type });
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Cache fake                                                                 */
/* -------------------------------------------------------------------------- */

interface MemoryCache extends ContentCache {
  readonly store: Map<string, CacheRecord<unknown>>;
}

function memoryCache(): MemoryCache {
  const store = new Map<string, CacheRecord<unknown>>();
  return {
    store,
    async get<T>(key: string): Promise<CacheRecord<T> | null> {
      return (store.get(key) as CacheRecord<T> | undefined) ?? null;
    },
    async put<T>(key: string, value: T, options: CachePutOptions): Promise<void> {
      store.set(key, {
        key,
        value,
        storedAt: NOW,
        expiresAt: NOW + options.ttlMs,
        version: options.version ?? 1,
      });
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    async clear(): Promise<void> {
      store.clear();
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Reader fake                                                                */
/* -------------------------------------------------------------------------- */

interface FakeResource {
  readonly service: string;
  readonly name: string;
  readonly identifier: string | null;
  readonly status?: string;
  readonly size?: number;
  readonly text?: string;
}

function readerWithResources(resources: FakeResource[]): QdnReadPort {
  const find = (service: string, identifier: string | null): FakeResource | undefined =>
    resources.find(
      (resource) => resource.service === service && (resource.identifier ?? null) === identifier,
    );
  return {
    async search(request): Promise<unknown[]> {
      const identifier = request.defaultResource ? null : (request.identifier ?? null);
      const hit = find(String(request.service ?? ''), identifier);
      if (!hit) return [];
      const normalized: QdnSearchHit = {
        service: hit.service,
        name: hit.name,
        identifier: hit.identifier,
        created: 1,
        updated: 1,
        size: hit.size ?? 128,
        status: hit.status ?? 'READY',
        metadata: null,
      };
      return [normalized];
    },
    async fetchText(ref): Promise<string> {
      const hit = find(ref.service, ref.identifier ?? null);
      if (!hit || hit.text === undefined) {
        throw new QortalBridgeError('error', 'Resource not found', 'FETCH_QDN_RESOURCE');
      }
      return hit.text;
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Writer fake                                                                */
/* -------------------------------------------------------------------------- */

type PublishHandler = (
  kind: 'single' | 'multi',
  resources: readonly PublishResourceInput[],
  callIndex: number,
) => PublishAttempt;

function submissionFor(resource: PublishResourceInput, callIndex: number): PublishSubmission {
  return {
    service: resource.service,
    identifier: resource.identifier ?? null,
    name: resource.name,
    signature: `signature-${callIndex}-${resource.service}`,
    raw: { signature: `signature-${callIndex}-${resource.service}` },
  };
}

function submitted(resources: readonly PublishResourceInput[], callIndex: number): PublishAttempt {
  return { kind: 'submitted', submissions: resources.map((r) => submissionFor(r, callIndex)) };
}

function failed(resource: PublishResourceInput, reason = 'host refused'): PublishAttempt {
  const failure: PublishFailure = {
    service: resource.service,
    identifier: resource.identifier ?? null,
    name: resource.name,
    reason,
  };
  return {
    kind: 'failed',
    error: new QortalBridgeError('error', reason, 'PUBLISH_QDN_RESOURCE'),
    failures: [failure],
  };
}

interface WriterFake {
  readonly port: PublishPort;
  readonly calls: { kind: 'single' | 'multi'; resources: readonly PublishResourceInput[] }[];
}

function writerFake(handler?: PublishHandler): WriterFake {
  const calls: WriterFake['calls'] = [];
  const port: PublishPort = {
    async publishResource(resource): Promise<PublishAttempt> {
      const index = calls.push({ kind: 'single', resources: [resource] });
      return handler ? handler('single', [resource], index) : submitted([resource], index);
    },
    async publishResources(resources): Promise<PublishAttempt> {
      const index = calls.push({ kind: 'multi', resources });
      return handler ? handler('multi', resources, index) : submitted(resources, index);
    },
  };
  return { port, calls };
}

function counterRandom(): (length: number) => Uint8Array {
  let call = 0;
  return (length: number): Uint8Array => {
    const bytes = new Uint8Array(length);
    for (let i = 0; i < length; i += 1) bytes[i] = (10 + i + call * 37) % 36;
    call += 1;
    return bytes;
  };
}

function makeDeps(overrides: Partial<BlogPublishDeps> = {}): BlogPublishDeps {
  return createBlogPublishDeps({
    reader: overrides.reader ?? readerWithResources([]),
    writer: overrides.writer ?? writerFake().port,
    cache: overrides.cache ?? memoryCache(),
    now: overrides.now ?? (() => NOW),
    random: overrides.random ?? counterRandom(),
    checksumFn: overrides.checksumFn ?? (async () => 'sha256:fixture'),
    imageDeps: overrides.imageDeps ?? fakeImageDeps(),
    delay: overrides.delay ?? (async () => undefined),
  });
}

/* -------------------------------------------------------------------------- */
/* Ownership bridge (GET_NAME_DATA is the only host call the service makes)   */
/* -------------------------------------------------------------------------- */

function installNameBridge(owner: () => string = () => OWNER): void {
  const mock = vi.fn(async (payload: Record<string, unknown>) => {
    if (payload.action === 'GET_NAME_DATA') {
      return { name: payload.name, owner: owner() };
    }
    throw new Error(`Unexpected bridge action: ${String(payload.action)}`);
  });
  Object.defineProperty(window, 'qortalRequest', {
    configurable: true,
    writable: true,
    value: mock,
  });
}

function data64Of(resource: PublishResourceInput): string {
  if (typeof resource.data64 !== 'string') {
    throw new Error('expected a base64 publish payload');
  }
  return resource.data64;
}

function decodePayload(data64: string): unknown {
  return JSON.parse(atob(data64)) as unknown;
}

afterEach(() => {
  resetAuthSession();
  Reflect.deleteProperty(window, 'qortalRequest');
});

/* -------------------------------------------------------------------------- */
/* Authority                                                                  */
/* -------------------------------------------------------------------------- */

describe('publishBlogPost — authority', () => {
  it('refuses a non-owner capability without any write', async () => {
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });

    await expect(
      publishBlogPost(ownerContext({ capability: 'visitor' }), blogDraft(), {}, deps),
    ).rejects.toMatchObject({ code: 'not-owner' });
    expect(writer.calls).toHaveLength(0);
  });

  it('refuses a runtime that is not a real Qortal host without any write', async () => {
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });

    await expect(
      publishBlogPost(
        ownerContext({ environment: makeEnvironment({ publisherName: PUBLISHER }) }),
        blogDraft(),
        {},
        deps,
      ),
    ).rejects.toMatchObject({ code: 'not-hosted' });
    expect(writer.calls).toHaveLength(0);
  });

  it('blocks the write when the publishing name is no longer owned', async () => {
    installNameBridge(() => OTHER);
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });

    await expect(publishBlogPost(ownerContext(), blogDraft(), {}, deps)).rejects.toMatchObject({
      code: 'authority-changed',
    });
    expect(writer.calls).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Input validation (fail closed before any write)                            */
/* -------------------------------------------------------------------------- */

describe('publishBlogPost — input validation', () => {
  it('rejects a missing title, language, body or cover before any write', async () => {
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });

    await expect(
      publishBlogPost(ownerContext(), blogDraft({ title: '   ' }), {}, deps),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(
      publishBlogPost(ownerContext(), blogDraft({ language: '' }), {}, deps),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(
      publishBlogPost(
        ownerContext(),
        blogDraft({ body: { format: 'tiptap-json-v1', doc: { type: 'doc', content: [] } } }),
        {},
        deps,
      ),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(
      publishBlogPost(ownerContext(), blogDraft({ cover: new File([], 'empty.png') }), {}, deps),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect(writer.calls).toHaveLength(0);
  });

  it('refuses a cover the browser encoded as non-WebP (SubWire renders webp literally)', async () => {
    const writer = writerFake();
    const deps = makeDeps({
      writer: writer.port,
      imageDeps: {
        async decode() {
          return { width: 1200, height: 800, close: () => undefined };
        },
        createCanvas(width, height) {
          return {
            canvas: { width, height } as unknown as HTMLCanvasElement,
            context: {
              clearRect: () => undefined,
              drawImage: () => undefined,
            } as unknown as CanvasRenderingContext2D,
          };
        },
        async toBlob() {
          // A browser that cannot encode WebP silently returns another type.
          return new Blob([new Uint8Array(128)], { type: 'image/png' });
        },
      },
    });
    await expect(publishBlogPost(ownerContext(), blogDraft(), {}, deps)).rejects.toMatchObject({
      code: 'cover-processing',
    });
    expect(writer.calls).toHaveLength(0);
  });

  it('refuses to publish when the cover cannot be prepared', async () => {
    const deps = makeDeps({
      imageDeps: {
        async decode() {
          throw new Error('decode failed');
        },
        createCanvas() {
          throw new Error('unused');
        },
        async toBlob() {
          throw new Error('unused');
        },
      },
    });
    await expect(publishBlogPost(ownerContext(), blogDraft(), {}, deps)).rejects.toMatchObject({
      code: 'cover-processing',
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Publication                                                                */
/* -------------------------------------------------------------------------- */

describe('publishBlogPost — publication', () => {
  it('publishes cover, entity+SubWire artifact and index in three truthful stages', async () => {
    installNameBridge();
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });

    const result = await publishBlogPost(ownerContext(), blogDraft(), {}, deps);

    expect(result.status).toBe('published');
    expect(result.indexUpdated).toBe(true);
    expect(result.publisherName).toBe(PUBLISHER);
    // The read fixture serves nothing, so availability is unconfirmed: the
    // result must say so rather than claim confirmation.
    expect(result.entityConfirmed).toBe(false);
    expect(result.message).toMatch(/availability is still being confirmed/i);

    const id = result.id;
    expect(id).toMatch(/^[0-9a-z]{12}$/);
    expect(result.entityIdentifier).toBe(`saw_post_${id}`);
    expect(result.thumbnailIdentifier).toBe(`saw_post_thumb_${id}`);
    expect(result.subwireIdentifier).toBe(await blogSubwireIdentifier(id));

    // Stage order: cover (single), entity+artifact (multi), catalog (multi).
    expect(writer.calls.map((call) => call.kind)).toEqual(['single', 'multi', 'multi']);
    expect(writer.calls[0].resources[0].service).toBe('THUMBNAIL');
    expect(writer.calls[0].resources[0].identifier).toBe(`saw_post_thumb_${id}`);

    const [entityResource, subwireResource] = writer.calls[1].resources;
    expect(entityResource.service).toBe('DOCUMENT');
    expect(entityResource.identifier).toBe(`saw_post_${id}`);
    expect(entityResource.title).toBe('Uncovering the past');
    expect(entityResource.tags).toEqual(['archive', 'qortal']);

    expect(subwireResource.service).toBe('DOCUMENT');
    expect(subwireResource.identifier).toBe(result.subwireIdentifier);

    const [partitionResource, manifestResource] = writer.calls[2].resources;
    expect(partitionResource.identifier).toBe('saw_cat_post_p000');
    expect(manifestResource.identifier).toBe('saw_cat_manifest');
  });

  it('writes an authoritative entity that validates and a SubWire artifact that passes SubWire’s own gate', async () => {
    installNameBridge();
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });

    const result = await publishBlogPost(ownerContext(), blogDraft(), {}, deps);

    const entityResource = writer.calls[1].resources[0];
    const entity = validateEntityPayload(decodePayload(data64Of(entityResource)), {
      expectedKind: 'blog-post',
    });
    expect(entity.ok).toBe(true);
    if (entity.ok && entity.value.kind === 'blog-post') {
      expect(entity.value.data.body.format).toBe('tiptap-json-v1');
      expect(entity.value.data.bodyText).toBe('The archive remembers.');
      expect(entity.value.data.thumbnail).toMatchObject({
        service: 'THUMBNAIL',
        name: PUBLISHER,
        identifier: `saw_post_thumb_${result.id}`,
      });
      expect(entity.value.data.categories).toEqual(['History']);
    }

    const subwireResource = writer.calls[1].resources[1];
    const served = decodePayload(data64Of(subwireResource));
    expect(isSubwireRenderableArticle(served)).toBe(true);
    expect(served).toMatchObject({
      title: 'Uncovering the past',
      type: 'essay',
      published: true,
      name: PUBLISHER,
      timestamp: NOW,
    });
    // Stored text is Markdown-escaped, so its literal period survives as `\.`.
    expect((served as { content: string }).content).toBe('The archive remembers\\.');
    expect(
      (served as { coverImage: { src: string } }).coverImage.src.startsWith('data:image/webp'),
    ).toBe(false);
    // SubWire renders the cover as `data:image/webp;base64,<src>`, so the stored
    // src is the raw base64 payload, not a data URL.
    expect((served as { coverImage: { src: string } }).coverImage.src).toMatch(/^[A-Za-z0-9+/=]+$/);
  });

  it('validates the derived catalog partition and manifest it publishes', async () => {
    installNameBridge();
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });

    const result = await publishBlogPost(ownerContext(), blogDraft(), {}, deps);

    const [partitionResource, manifestResource] = writer.calls[2].resources;
    const partition = validateCatalogPartition(decodePayload(data64Of(partitionResource)));
    expect(partition.ok).toBe(true);
    if (partition.ok) {
      expect(partition.value.type).toBe('blog-post');
      expect(partition.value.listings.map((listing) => listing.id)).toContain(result.id);
      const listing = partition.value.listings.find((entry) => entry.id === result.id);
      expect(listing).toMatchObject({
        type: 'blog-post',
        title: 'Uncovering the past',
        identifier: `saw_post_${result.id}`,
      });
    }
    expect(validateCatalogManifest(decodePayload(data64Of(manifestResource))).ok).toBe(true);
  });

  it('reuses a supplied id so a retry cannot mint a duplicate', async () => {
    installNameBridge();
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });

    const first = await publishBlogPost(ownerContext(), blogDraft({ id: FIXED_ID }), {}, deps);
    const second = await publishBlogPost(ownerContext(), blogDraft({ id: FIXED_ID }), {}, deps);

    expect(first.id).toBe(FIXED_ID);
    expect(second.entityIdentifier).toBe(first.entityIdentifier);
    expect(second.subwireIdentifier).toBe(first.subwireIdentifier);
    expect(second.thumbnailIdentifier).toBe(first.thumbnailIdentifier);
  });

  it('reports index-incomplete when the article is authoritative but the derived index failed', async () => {
    installNameBridge();
    // Cover (call 1) and article (call 2) succeed; the catalog pair (call 3) fails.
    const writer = writerFake((_kind, resources, callIndex) =>
      callIndex === 3 ? failed(resources[0]) : submitted(resources, callIndex),
    );
    const deps = makeDeps({ writer: writer.port });

    const result = await publishBlogPost(ownerContext(), blogDraft({ id: FIXED_ID }), {}, deps);

    expect(result.status).toBe('index-incomplete');
    expect(result.indexUpdated).toBe(false);
    expect(result.entityIdentifier).toBe(`saw_post_${FIXED_ID}`);
    expect(result.subwireIdentifier).toBe(await blogSubwireIdentifier(FIXED_ID));
    expect(result.message).toMatch(/Article published, index update/i);
    expect(result.failures[0]?.reason).toBe('host refused');
  });

  it('reports ambiguous (never a retry) when the article submission times out', async () => {
    installNameBridge();
    const writer = writerFake((_kind, resources, callIndex) =>
      callIndex === 2
        ? {
            kind: 'ambiguous',
            error: new QortalBridgeError('timeout', 'timeout', 'PUBLISH_MULTIPLE_QDN_RESOURCES'),
          }
        : submitted(resources, callIndex),
    );
    const deps = makeDeps({ writer: writer.port });

    const result = await publishBlogPost(ownerContext(), blogDraft({ id: FIXED_ID }), {}, deps);

    expect(result.status).toBe('ambiguous');
    // The article stage was the last write: no catalog attempt after a timeout.
    expect(writer.calls).toHaveLength(2);
    expect(result.message).toMatch(/retried automatically/i);
  });

  it('reports partial and points at the authoritative entity when only one article resource landed', async () => {
    installNameBridge();
    const writer = writerFake((_kind, resources, callIndex) => {
      if (callIndex !== 2) return submitted(resources, callIndex);
      const [entity] = resources;
      return {
        kind: 'partial',
        submissions: [submissionFor(entity, callIndex)],
        failures: [
          {
            service: resources[1].service,
            identifier: resources[1].identifier ?? null,
            name: resources[1].name,
            reason: 'artifact rejected',
          },
        ],
      };
    });
    const deps = makeDeps({ writer: writer.port });

    const result = await publishBlogPost(ownerContext(), blogDraft({ id: FIXED_ID }), {}, deps);

    expect(result.status).toBe('partial');
    expect(result.message).toMatch(/authoritative article entity/i);
    expect(result.submissions.map((entry) => entry.identifier)).toContain(`saw_post_${FIXED_ID}`);
  });

  it('reports failure when the cover stage fails and never writes the article', async () => {
    installNameBridge();
    const writer = writerFake((_kind, resources, callIndex) =>
      callIndex === 1 ? failed(resources[0], 'no fee') : submitted(resources, callIndex),
    );
    const deps = makeDeps({ writer: writer.port });

    const result = await publishBlogPost(ownerContext(), blogDraft({ id: FIXED_ID }), {}, deps);

    expect(result.status).toBe('failed');
    expect(writer.calls).toHaveLength(1);
    expect(result.entityConfirmed).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Optional Quitter announcement                                              */
/* -------------------------------------------------------------------------- */

describe('announceOnQuitter', () => {
  it('is a separate explicit write that publishes a Quitter-renderable post', async () => {
    installNameBridge();
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });

    const result = await announceOnQuitter(
      ownerContext(),
      { id: FIXED_ID, text: 'New publication: Uncovering the past', coverBase64: 'AAAA' },
      deps,
    );

    expect(result.status).toBe('announced');
    expect(writer.calls).toHaveLength(1);
    expect(writer.calls[0].kind).toBe('single');
    expect(result.identifier).toBe(await quitterPostIdentifier(FIXED_ID));

    const served = decodePayload(data64Of(writer.calls[0].resources[0]));
    expect(isQuitterRenderablePost(served)).toBe(true);
    expect(served).toMatchObject({ text: 'New publication: Uncovering the past', name: PUBLISHER });
    expect((served as { images: unknown[] }).images).toHaveLength(1);
  });

  it('stays announced without a cover image when none is supplied', async () => {
    installNameBridge();
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });

    const result = await announceOnQuitter(
      ownerContext(),
      { id: FIXED_ID, text: 'text only', coverBase64: null },
      deps,
    );

    expect(result.status).toBe('announced');
    expect((result.postPayload as { images?: unknown[] }).images).toBeUndefined();
  });

  it('reports ambiguous on a timed-out announcement and does not retry', async () => {
    installNameBridge();
    const writer = writerFake(() => ({
      kind: 'ambiguous',
      error: new QortalBridgeError('timeout', 'timeout', 'PUBLISH_QDN_RESOURCE'),
    }));
    const deps = makeDeps({ writer: writer.port });

    const result = await announceOnQuitter(
      ownerContext(),
      { id: FIXED_ID, text: 'announce', coverBase64: null },
      deps,
    );

    expect(result.status).toBe('ambiguous');
    expect(writer.calls).toHaveLength(1);
    expect(result.message).toMatch(/retried automatically/i);
  });

  it('refuses a non-owner, so an announcement always carries its own approval', async () => {
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });

    await expect(
      announceOnQuitter(
        ownerContext({ capability: 'visitor' }),
        { id: FIXED_ID, text: 'nope', coverBase64: null },
        deps,
      ),
    ).rejects.toMatchObject({ code: 'not-owner' });
    expect(writer.calls).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Readback through the normal read pipeline                                  */
/* -------------------------------------------------------------------------- */

describe('published post is readable through the app read path', () => {
  it('validates as an entity and loads through loadEntityDetail/loadCatalog', async () => {
    installNameBridge();
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });

    const result = await publishBlogPost(ownerContext(), blogDraft({ id: FIXED_ID }), {}, deps);

    const entityResource = writer.calls[1].resources[0];
    const entityText = atob(data64Of(entityResource));
    const [partitionResource, manifestResource] = writer.calls[2].resources;
    const reader = readerWithResources([
      {
        service: 'DOCUMENT',
        name: PUBLISHER,
        identifier: `saw_post_${FIXED_ID}`,
        text: entityText,
      },
      {
        service: 'DOCUMENT',
        name: PUBLISHER,
        identifier: 'saw_cat_manifest',
        text: atob(data64Of(manifestResource)),
      },
      {
        service: 'DOCUMENT',
        name: PUBLISHER,
        identifier: 'saw_cat_post_p000',
        text: atob(data64Of(partitionResource)),
      },
    ]);

    const detail = await loadEntityDetail(
      { scoped: true, name: PUBLISHER, service: 'DOCUMENT' },
      'blog-post',
      FIXED_ID,
      { reader, cache: memoryCache(), now: NOW },
    );
    expect(detail.entity?.kind).toBe('blog-post');
    if (detail.entity?.kind === 'blog-post') {
      expect(detail.entity.data.bodyText).toBe('The archive remembers.');
    }

    const catalog = await loadCatalog(reader, memoryCache(), PUBLISHER, { now: NOW });
    expect(catalog.kind).toBe('loaded');
    if (catalog.kind !== 'loaded') return;
    expect(catalog.listings.find((entry) => entry.id === result.id)).toMatchObject({
      type: 'blog-post',
      title: 'Uncovering the past',
      thumbnail: { service: 'THUMBNAIL', identifier: `saw_post_thumb_${FIXED_ID}` },
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Verification                                                               */
/* -------------------------------------------------------------------------- */

describe('verifyBlogPublication', () => {
  it('confirms all three resources when the served payloads match', async () => {
    installNameBridge();
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });
    const before = await publishBlogPost(ownerContext(), blogDraft({ id: FIXED_ID }), {}, deps);

    const entityText = atob(data64Of(writer.calls[1].resources[0]));
    const subwireText = atob(data64Of(writer.calls[1].resources[1]));
    const reader = readerWithResources([
      {
        service: 'DOCUMENT',
        name: PUBLISHER,
        identifier: `saw_post_${FIXED_ID}`,
        text: entityText,
      },
      {
        service: 'THUMBNAIL',
        name: PUBLISHER,
        identifier: `saw_post_thumb_${FIXED_ID}`,
        text: 'x',
      },
      {
        service: 'DOCUMENT',
        name: PUBLISHER,
        identifier: before.subwireIdentifier,
        text: subwireText,
      },
    ]);
    const verifyDeps = makeDeps({ reader });

    const result = await verifyBlogPublication(
      { id: FIXED_ID, publisherName: PUBLISHER, expectedEntityPayload: before.entityPayload },
      verifyDeps,
    );

    expect(result.summary).toBe('confirmed');
    expect(result.entity.present).toBe(true);
    expect(result.thumbnail.present).toBe(true);
    expect(result.subwire.present).toBe(true);
    expect(result.contentMatches).toBe(true);
    expect(result.subwireValid).toBe(true);
    expect(result.entityIdentifier).toBe(`saw_post_${FIXED_ID}`);
  });

  it('reports missing when a resource is absent, without fabricating confirmation', async () => {
    const reader = readerWithResources([]);
    const result = await verifyBlogPublication(
      { id: FIXED_ID, publisherName: PUBLISHER },
      makeDeps({ reader }),
    );

    expect(result.summary).toBe('missing');
    expect(result.entity.present).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Identifier helpers                                                          */
/* -------------------------------------------------------------------------- */

describe('blog identifier helpers', () => {
  it('recognizes a SubWire artifact that carries this post id', async () => {
    const identifier = await blogSubwireIdentifier(FIXED_ID);
    expect(await isSubwireArtifactOf(identifier, FIXED_ID)).toBe(true);
    expect(await isSubwireArtifactOf(identifier, 'zzzzzzzzzzzz')).toBe(false);
    expect(await isSubwireArtifactOf('not-an-identifier', FIXED_ID)).toBe(false);
  });

  it('extracts the post id from a Quitter announcement identifier', async () => {
    expect(await quitterAnnouncementIdOf(await quitterPostIdentifier(FIXED_ID))).toBe(FIXED_ID);
    expect(await quitterAnnouncementIdOf('random')).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Error type                                                                 */
/* -------------------------------------------------------------------------- */

describe('BlogPublishError', () => {
  it('carries a stable code for the owner-facing taxonomy', () => {
    const error = new BlogPublishError('not-owner', 'Nope');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('BlogPublishError');
    expect(error.code).toBe('not-owner');
  });
});
