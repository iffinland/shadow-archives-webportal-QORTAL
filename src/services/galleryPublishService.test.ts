import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeEnvironment } from '../test/environment';
import { validateCatalogManifest, validateCatalogPartition } from '../domain/catalog';
import { validateEntityPayload } from '../domain/entities';
import type { CatalogListing, GalleryAlbum, GalleryItem } from '../domain/types';
import { resetAuthSession } from '../qortal/auth';
import { QortalBridgeError } from '../qortal/bridge';
import type {
  PublishAttempt,
  PublishPort,
  PublishResourceInput,
  PublishSubmission,
} from '../qortal/publish';
import type { CachePutOptions, CacheRecord, ContentCache } from './cache';
import type { ImageProcessingDeps } from './imageProcessing';
import type { QdnReadPort, QdnSearchHit } from './qdnReader';
import {
  catalogEntryFromGalleryItem,
  planCatalogWrite,
  CATALOG_PARTITION_CAPACITY,
} from './catalogWriter';
import { catalogEntryFromGalleryAlbum } from './catalogWriter';
import { loadCatalog } from './catalogRepository';
import { loadEntityDetail } from './contentRepository';
import { resolvePublisherScope } from './publisher';
import {
  createGalleryPublishDeps,
  GalleryPublishError,
  publishGalleryAlbum,
  publishGalleryImage,
  verifyGalleryPublication,
  type GalleryImageDraft,
  type GalleryPublishDeps,
  type OwnerWriteContext,
} from './galleryPublishService';

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

function pngFile(name = 'photo.png'): File {
  return new File([PNG_HEADER], name, { type: 'image/png' });
}

function imageDraft(overrides: Partial<GalleryImageDraft> = {}): GalleryImageDraft {
  return {
    file: pngFile(),
    title: 'Sunset over the harbour',
    description: 'A wide shot from the pier.',
    albumId: null,
    categories: ['Archive'],
    tags: ['sunset'],
    language: 'en',
    ...overrides,
  };
}

/** Deterministic image deps: no canvas, no real decoding, predictable sizes. */
function fakeImageDeps(
  options: { width?: number; height?: number; thumbnailBytes?: number } = {},
): ImageProcessingDeps {
  const width = options.width ?? 1600;
  const height = options.height ?? 900;
  return {
    async decode() {
      return { width, height, close: () => undefined };
    },
    createCanvas(canvasWidth, canvasHeight) {
      const canvas = { width: canvasWidth, height: canvasHeight } as unknown as HTMLCanvasElement;
      const context = {
        clearRect: () => undefined,
        drawImage: () => undefined,
      } as unknown as CanvasRenderingContext2D;
      return { canvas, context };
    },
    async toBlob(canvas, type) {
      const target = canvas as unknown as { width: number; height: number };
      const thumbnail = target.width <= 480;
      const size =
        thumbnail && options.thumbnailBytes
          ? options.thumbnailBytes
          : Math.max(32, Math.round((target.width * target.height) / 64));
      return new Blob([new Uint8Array(size)], { type });
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Cache fake                                                                 */
/* -------------------------------------------------------------------------- */

interface MemoryCache extends ContentCache {
  readonly store: Map<string, CacheRecord<unknown>>;
  readonly deleted: string[];
}

function memoryCache(seed: Record<string, unknown> = {}): MemoryCache {
  const store = new Map<string, CacheRecord<unknown>>();
  const deleted: string[] = [];
  for (const [key, value] of Object.entries(seed)) {
    store.set(key, { key, value, storedAt: NOW, expiresAt: NOW + 60_000, version: 1 });
  }
  return {
    store,
    deleted,
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
      deleted.push(key);
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

interface SearchShape {
  readonly service?: string;
  readonly identifier?: string;
  readonly defaultResource?: boolean;
}

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
    async search(request: SearchShape): Promise<unknown[]> {
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

function failingReader(message = 'QDN read failed'): QdnReadPort {
  return {
    async search(): Promise<unknown[]> {
      throw new QortalBridgeError('error', message, 'SEARCH_QDN_RESOURCES');
    },
    async fetchText(): Promise<string> {
      throw new QortalBridgeError('error', message, 'FETCH_QDN_RESOURCE');
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

function makeDeps(overrides: Partial<GalleryPublishDeps> = {}): GalleryPublishDeps {
  return createGalleryPublishDeps({
    reader: overrides.reader ?? readerWithResources([]),
    writer: overrides.writer ?? writerFake().port,
    cache: overrides.cache ?? memoryCache(),
    now: overrides.now ?? (() => NOW),
    random: overrides.random ?? counterRandom(),
    checksumFn: overrides.checksumFn ?? (async () => 'sha256:fixture'),
    imageDeps: overrides.imageDeps ?? fakeImageDeps(),
  });
}

/* -------------------------------------------------------------------------- */
/* Ownership bridge (GET_NAME_DATA is the only host call the service makes)   */
/* -------------------------------------------------------------------------- */

function installNameBridge(owner: () => string = () => OWNER): { readonly calls: string[] } {
  const calls: string[] = [];
  const mock = vi.fn(async (payload: Record<string, unknown>) => {
    if (payload.action === 'GET_NAME_DATA') {
      calls.push('GET_NAME_DATA');
      return { name: payload.name, owner: owner() };
    }
    throw new Error(`Unexpected bridge action: ${String(payload.action)}`);
  });
  Object.defineProperty(window, 'qortalRequest', {
    configurable: true,
    writable: true,
    value: mock,
  });
  return { calls };
}

function decodePayload(data64: string): unknown {
  return JSON.parse(atob(data64)) as unknown;
}

function existingItemEntry(
  id: string,
  updatedAt = 1,
): Omit<CatalogListing, 'type' | 'partitionIdentifier'> {
  return {
    id,
    service: 'DOCUMENT',
    identifier: `saw_img_${id}`,
    title: 'Existing item',
    slug: 'existing-item',
    excerpt: 'Already in the catalog.',
    createdAt: 1,
    updatedAt,
    categories: ['Archive'],
    tags: [],
    thumbnail: null,
    state: 'active',
    contentHash: null,
    likeCount: null,
    commentCount: null,
    countsCompiledAt: null,
    durationSeconds: null,
    width: 100,
    height: 100,
    albumId: null,
  };
}

function existingManifest(catalogVersion: number, count: number) {
  return {
    schemaVersion: 1,
    kind: 'catalog-manifest',
    catalogVersion,
    compiledAt: 1,
    publisherName: PUBLISHER,
    partitions: [
      {
        identifier: 'saw_cat_img_p000',
        type: 'gallery-item',
        count,
        maxUpdated: 1,
        checksum: null,
      },
    ],
    taxonomy: { categories: ['Archive'], tags: [] },
  };
}

function existingPartition(entries: unknown[]) {
  return {
    schemaVersion: 1,
    kind: 'catalog-partition',
    type: 'gallery-item',
    partition: 0,
    compiledAt: 1,
    entries,
  };
}

afterEach(() => {
  resetAuthSession();
  Reflect.deleteProperty(window, 'qortalRequest');
});

/* -------------------------------------------------------------------------- */
/* Authority                                                                  */
/* -------------------------------------------------------------------------- */

describe('publishGalleryImage — authority', () => {
  it('refuses to publish for a non-owner capability without any write', async () => {
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });
    installNameBridge();

    await expect(
      publishGalleryImage(ownerContext({ capability: 'visitor' }), imageDraft(), {}, deps),
    ).rejects.toMatchObject({ name: 'GalleryPublishError', code: 'not-owner' });
    expect(writer.calls).toHaveLength(0);
  });

  it('refuses to publish outside a real Qortal host', async () => {
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });
    installNameBridge();

    await expect(
      publishGalleryImage(
        ownerContext({
          environment: makeEnvironment({
            bridgeAvailable: false,
            isHosted: false,
            publisherName: PUBLISHER,
          }),
        }),
        imageDraft(),
        {},
        deps,
      ),
    ).rejects.toMatchObject({ code: 'not-hosted' });
    expect(writer.calls).toHaveLength(0);
  });

  it('re-checks name ownership immediately before every write stage', async () => {
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });
    const bridge = installNameBridge();

    await publishGalleryImage(ownerContext(), imageDraft({ id: FIXED_ID }), {}, deps);

    // media -> entity -> catalog are three distinct write stages.
    expect(writer.calls).toHaveLength(3);
    expect(bridge.calls).toHaveLength(3);
  });

  it('blocks the write when the publishing name was transferred away', async () => {
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });
    installNameBridge(() => OTHER);

    await expect(publishGalleryImage(ownerContext(), imageDraft(), {}, deps)).rejects.toMatchObject(
      { code: 'authority-changed' },
    );
    expect(writer.calls).toHaveLength(0);
  });

  it('fails closed when the current owner cannot be re-established', async () => {
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });
    const mock = vi.fn(async () => {
      throw new Error('node unreachable');
    });
    Object.defineProperty(window, 'qortalRequest', {
      configurable: true,
      writable: true,
      value: mock,
    });

    await expect(publishGalleryImage(ownerContext(), imageDraft(), {}, deps)).rejects.toMatchObject(
      { code: 'authority-unresolved' },
    );
    expect(writer.calls).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Image item contracts                                                       */
/* -------------------------------------------------------------------------- */

describe('publishGalleryImage — contracts', () => {
  it('generates a 12-char base36 id and couples media identifiers to it', async () => {
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });
    installNameBridge();

    const result = await publishGalleryImage(ownerContext(), imageDraft(), {}, deps);

    expect(result.id).toMatch(/^[0-9a-z]{12}$/);
    expect(result.mediaIdentifier).toBe(`saw_img_media_${result.id}`);
    expect(result.thumbnailIdentifier).toBe(`saw_img_thumb_${result.id}`);
    expect(result.entityIdentifier).toBe(`saw_img_${result.id}`);
    expect(result.status).toBe('published');
  });

  it('publishes media first, then the entity, then the catalog', async () => {
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });
    installNameBridge();

    await publishGalleryImage(ownerContext(), imageDraft({ id: FIXED_ID }), {}, deps);

    expect(writer.calls.map((call) => call.kind)).toEqual(['multi', 'single', 'multi']);
    expect(writer.calls[0].resources.map((r) => r.service)).toEqual(['IMAGE', 'THUMBNAIL']);
    expect(writer.calls[0].resources.map((r) => r.identifier)).toEqual([
      `saw_img_media_${FIXED_ID}`,
      `saw_img_thumb_${FIXED_ID}`,
    ]);
    expect(writer.calls[1].resources[0].service).toBe('DOCUMENT');
    expect(writer.calls[1].resources[0].identifier).toBe(`saw_img_${FIXED_ID}`);
  });

  it('produces a DOCUMENT entity the existing runtime validator accepts', async () => {
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });
    installNameBridge();

    const result = await publishGalleryImage(
      ownerContext(),
      imageDraft({ id: FIXED_ID, albumId: null }),
      {},
      deps,
    );

    const documentCall = writer.calls.find((call) => call.kind === 'single');
    const payload = decodePayload(documentCall!.resources[0].data64);
    const validated = validateEntityPayload(payload, { expectedKind: 'gallery-item' });
    expect(validated.ok).toBe(true);

    const entity = validated.ok ? validated.value : null;
    expect(entity?.id).toBe(FIXED_ID);
    expect(entity?.publisher).toBe(PUBLISHER);
    expect(entity?.data).toMatchObject({
      title: 'Sunset over the harbour',
      albumId: null,
      width: 1600,
      height: 900,
      language: 'en',
    });
    expect((entity?.data as { media: { identifier: string } }).media.identifier).toBe(
      `saw_img_media_${FIXED_ID}`,
    );
    expect(result.entitySignature).toBe(`signature-2-DOCUMENT`);
  });

  it('mirrors bounded Core metadata without exceeding the Core limits', async () => {
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });
    installNameBridge();

    const longTitle = 'T'.repeat(200);
    await publishGalleryImage(
      ownerContext(),
      imageDraft({
        title: longTitle,
        description: 'D'.repeat(600),
        tags: ['a', 'b', 'c', 'd', 'e', 'f'],
      }),
      {},
      deps,
    );

    const entity = writer.calls[1].resources[0];
    expect((entity.title ?? '').length).toBeLessThanOrEqual(80);
    expect((entity.description ?? '').length).toBeLessThanOrEqual(240);
    expect(entity.tags?.length).toBe(5);
  });

  it('rejects a non-image file before any write', async () => {
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });
    installNameBridge();

    await expect(
      publishGalleryImage(
        ownerContext(),
        imageDraft({ file: new File(['not an image'], 'notes.txt', { type: 'text/plain' }) }),
        {},
        deps,
      ),
    ).rejects.toMatchObject({ code: 'image-processing' });
    expect(writer.calls).toHaveLength(0);
  });

  it('reuses an explicit id so a retry cannot duplicate the item', async () => {
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });
    installNameBridge();

    const result = await publishGalleryImage(
      ownerContext(),
      imageDraft({ id: 'zzzzzzzzzzzz' }),
      {},
      deps,
    );
    expect(result.id).toBe('zzzzzzzzzzzz');
  });

  it('retries id generation when a candidate already exists (bounded)', async () => {
    const taken = 'abcdefghijkl';
    const resources: FakeResource[] = [
      { service: 'DOCUMENT', name: PUBLISHER, identifier: `saw_img_${taken}`, text: '{}' },
    ];
    const writer = writerFake();
    const deps = makeDeps({
      writer: writer.port,
      reader: readerWithResources(resources),
      random: counterRandom(),
    });
    installNameBridge();

    const result = await publishGalleryImage(ownerContext(), imageDraft(), {}, deps);
    expect(result.id).not.toBe(taken);
    expect(result.id).toMatch(/^[0-9a-z]{12}$/);
  });
});

/* -------------------------------------------------------------------------- */
/* Album contracts                                                            */
/* -------------------------------------------------------------------------- */

describe('publishGalleryAlbum — contracts', () => {
  it('produces an album entity the existing runtime validator accepts', async () => {
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });
    installNameBridge();

    const result = await publishGalleryAlbum(
      ownerContext(),
      {
        title: 'Coastal walks',
        description: 'Photos from the shoreline.',
        categories: ['Archive'],
        tags: ['coast'],
        language: 'en',
        id: FIXED_ID,
      },
      {},
      deps,
    );

    expect(result.entityIdentifier).toBe(`saw_album_${FIXED_ID}`);
    const payload = decodePayload(writer.calls[0].resources[0].data64);
    const validated = validateEntityPayload(payload, { expectedKind: 'gallery-album' });
    expect(validated.ok).toBe(true);
    expect((validated.ok ? validated.value : null)?.data).toMatchObject({
      title: 'Coastal walks',
      coverThumbnail: null,
    });
    // Album publication is entity first, then the derived catalog.
    expect(writer.calls.map((call) => call.kind)).toEqual(['single', 'multi']);
  });
});

/* -------------------------------------------------------------------------- */
/* Catalog bootstrap / merge                                                  */
/* -------------------------------------------------------------------------- */

describe('publishGalleryImage — catalog', () => {
  it('bootstraps the first Gallery partition and manifest when no catalog exists', async () => {
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });
    installNameBridge();

    const result = await publishGalleryImage(
      ownerContext(),
      imageDraft({ id: FIXED_ID }),
      {},
      deps,
    );

    expect(result.indexUpdated).toBe(true);
    const catalogCall = writer.calls[2];
    expect(catalogCall.resources.map((r) => r.identifier)).toEqual([
      'saw_cat_img_p000',
      'saw_cat_manifest',
    ]);

    const manifest = decodePayload(catalogCall.resources[1].data64);
    const manifestValidation = validateCatalogManifest(manifest);
    expect(manifestValidation.ok).toBe(true);
    expect(manifestValidation.ok ? manifestValidation.value.catalogVersion : null).toBe(1);
    expect(manifestValidation.ok ? manifestValidation.value.partitions : []).toEqual([
      {
        identifier: 'saw_cat_img_p000',
        type: 'gallery-item',
        count: 1,
        maxUpdated: NOW,
        checksum: 'sha256:fixture',
      },
    ]);

    const partition = decodePayload(catalogCall.resources[0].data64);
    const partitionValidation = validateCatalogPartition(
      partition,
      'gallery-item',
      'saw_cat_img_p000',
    );
    expect(partitionValidation.ok).toBe(true);
    expect(partitionValidation.ok ? partitionValidation.value.listings : []).toHaveLength(1);
    expect(partitionValidation.ok ? partitionValidation.value.listings[0].id : null).toBe(FIXED_ID);
  });

  it('merges into an existing partition without dropping existing entries', async () => {
    const reader = readerWithResources([
      {
        service: 'DOCUMENT',
        name: PUBLISHER,
        identifier: 'saw_cat_manifest',
        text: JSON.stringify(existingManifest(3, 1)),
      },
      {
        service: 'DOCUMENT',
        name: PUBLISHER,
        identifier: 'saw_cat_img_p000',
        text: JSON.stringify(existingPartition([existingItemEntry('existing0001')])),
      },
    ]);
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port, reader });
    installNameBridge();

    const result = await publishGalleryImage(
      ownerContext(),
      imageDraft({ id: FIXED_ID }),
      {},
      deps,
    );

    expect(result.indexUpdated).toBe(true);
    const catalogCall = writer.calls[2];
    const manifest = decodePayload(catalogCall.resources[1].data64);
    const manifestValidation = validateCatalogManifest(manifest);
    expect(manifestValidation.ok ? manifestValidation.value.catalogVersion : null).toBe(4);

    const partition = decodePayload(catalogCall.resources[0].data64);
    const partitionValidation = validateCatalogPartition(partition);
    const ids = partitionValidation.ok
      ? partitionValidation.value.listings.map((listing) => listing.id)
      : [];
    expect(ids).toHaveLength(2);
    expect(ids).toContain('existing0001');
    expect(ids).toContain(FIXED_ID);
    expect(manifestValidation.ok ? manifestValidation.value.partitions[0].count : null).toBe(2);
  });

  it('does not duplicate an entry when the same id is published again', async () => {
    const reader = readerWithResources([
      {
        service: 'DOCUMENT',
        name: PUBLISHER,
        identifier: 'saw_cat_manifest',
        text: JSON.stringify(existingManifest(2, 1)),
      },
      {
        service: 'DOCUMENT',
        name: PUBLISHER,
        identifier: 'saw_cat_img_p000',
        text: JSON.stringify(existingPartition([existingItemEntry(FIXED_ID)])),
      },
    ]);
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port, reader });
    installNameBridge();

    await publishGalleryImage(ownerContext(), imageDraft({ id: FIXED_ID }), {}, deps);

    const partition = decodePayload(writer.calls[2].resources[0].data64);
    const partitionValidation = validateCatalogPartition(partition);
    expect(partitionValidation.ok ? partitionValidation.value.listings : []).toHaveLength(1);
  });

  it('never lets a catalog planning failure block the authoritative content write', async () => {
    const writer = writerFake();
    const deps = makeDeps({
      writer: writer.port,
      checksumFn: async () => {
        throw new Error('checksum unavailable');
      },
    });
    installNameBridge();

    const result = await publishGalleryImage(
      ownerContext(),
      imageDraft({ id: FIXED_ID }),
      {},
      deps,
    );

    expect(result.status).toBe('index-incomplete');
    expect(result.indexUpdated).toBe(false);
    expect(result.entityIdentifier).toBe(`saw_img_${FIXED_ID}`);
    expect(result.message).toContain('index update incomplete');
    // media + entity published; the derived index was skipped, not fatal.
    expect(writer.calls).toHaveLength(2);
  });

  it('does not block publishing when the index cannot be read (content is authoritative)', async () => {
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port, reader: failingReader() });
    installNameBridge();

    const result = await publishGalleryImage(
      ownerContext(),
      imageDraft({ id: FIXED_ID }),
      {},
      deps,
    );

    expect(result.status).toBe('index-incomplete');
    expect(result.indexUpdated).toBe(false);
    expect(result.entityIdentifier).toBe(`saw_img_${FIXED_ID}`);
    expect(result.message).toContain('index update incomplete');
    // media + entity only: the derived index was left untouched.
    expect(writer.calls).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Read-pipeline compatibility (owner-visible exit criterion)                  */
/* -------------------------------------------------------------------------- */

describe('published Gallery content is consumable by the existing read pipeline', () => {
  it('round-trips the published entity + catalog through the unchanged read path', async () => {
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });
    installNameBridge();

    const result = await publishGalleryImage(
      ownerContext(),
      imageDraft({ id: FIXED_ID }),
      {},
      deps,
    );
    expect(result.status).toBe('published');

    const entityText = atob(writer.calls[1].resources[0].data64);
    const partitionText = atob(writer.calls[2].resources[0].data64);
    const manifestText = atob(writer.calls[2].resources[1].data64);

    // Serve back exactly what was published, with no test-only shape.
    const reader = readerWithResources([
      { service: 'DOCUMENT', name: PUBLISHER, identifier: 'saw_cat_manifest', text: manifestText },
      {
        service: 'DOCUMENT',
        name: PUBLISHER,
        identifier: 'saw_cat_img_p000',
        text: partitionText,
      },
      {
        service: 'DOCUMENT',
        name: PUBLISHER,
        identifier: `saw_img_${FIXED_ID}`,
        text: entityText,
      },
      { service: 'IMAGE', name: PUBLISHER, identifier: `saw_img_media_${FIXED_ID}` },
      { service: 'THUMBNAIL', name: PUBLISHER, identifier: `saw_img_thumb_${FIXED_ID}` },
    ]);

    const catalog = await loadCatalog(reader, memoryCache(), PUBLISHER, { force: true });
    expect(catalog.kind).toBe('loaded');
    const listing =
      catalog.kind === 'loaded' ? catalog.listings.find((item) => item.id === FIXED_ID) : undefined;
    expect(listing).toBeDefined();
    expect(listing?.title).toBe('Sunset over the harbour');
    expect(listing?.service).toBe('DOCUMENT');
    expect(listing?.identifier).toBe(`saw_img_${FIXED_ID}`);

    const detail = await loadEntityDetail(resolvePublisherScope(HOSTED), 'gallery-item', FIXED_ID, {
      reader,
      cache: memoryCache(),
    });
    expect(detail.status).toBe('ready');
    expect(detail.entity?.id).toBe(FIXED_ID);
    expect(detail.entity?.kind).toBe('gallery-item');
  });
});

/* -------------------------------------------------------------------------- */
/* Catalog partition rollover                                                 */
/* -------------------------------------------------------------------------- */

describe('planCatalogWrite — partition capacity', () => {
  it('starts a new partition once the current one is full', async () => {
    const entries = Array.from({ length: CATALOG_PARTITION_CAPACITY }, (_, index) =>
      existingItemEntry(`existing${String(index).padStart(4, '0')}`),
    );
    const item = validateEntityPayload(
      {
        schemaVersion: 1,
        kind: 'gallery-item',
        id: FIXED_ID,
        publisher: PUBLISHER,
        createdAt: NOW,
        updatedAt: NOW,
        state: 'active',
        data: {
          title: 'Rollover',
          description: '',
          albumId: null,
          media: { service: 'IMAGE', name: PUBLISHER, identifier: `saw_img_media_${FIXED_ID}` },
          thumbnail: null,
          width: 10,
          height: 10,
          categories: [],
          tags: [],
          language: 'en',
        },
      },
      { expectedKind: 'gallery-item' },
    );
    if (!item.ok) throw new Error('fixture invalid');
    const galleryItem = item.value as GalleryItem;
    const manifestValidation = validateCatalogManifest(existingManifest(5, entries.length));
    if (!manifestValidation.ok) throw new Error('fixture manifest invalid');

    const plan = await planCatalogWrite({
      type: 'gallery-item',
      entry: catalogEntryFromGalleryItem(galleryItem, null),
      publisherName: PUBLISHER,
      compiledAt: NOW,
      existing: {
        manifest: manifestValidation.value,
        listings: entries.map((entry) => ({
          ...entry,
          type: 'gallery-item' as const,
          partitionIdentifier: 'saw_cat_img_p000',
        })),
      },
      checksumFn: async () => null,
    });

    expect(plan.partitionIdentifier).toBe('saw_cat_img_p001');
    expect(plan.partition.entries).toHaveLength(1);
    expect(plan.createdCatalog).toBe(false);
    expect(plan.manifest.partitions.map((p) => p.identifier)).toEqual([
      'saw_cat_img_p000',
      'saw_cat_img_p001',
    ]);
  });
});

/* -------------------------------------------------------------------------- */
/* Failure semantics                                                          */
/* -------------------------------------------------------------------------- */

describe('publishGalleryImage — failure semantics', () => {
  it('reports a grouped-publish partial failure truthfully and stops the chain', async () => {
    const writer = writerFake((kind, resources, index) => {
      if (kind === 'multi' && index === 1) {
        return {
          kind: 'partial',
          submissions: [submissionFor(resources[0], index)],
          failures: [
            {
              service: 'THUMBNAIL',
              identifier: `saw_img_thumb_${FIXED_ID}`,
              name: PUBLISHER,
              reason: 'Thumbnail rejected',
            },
          ],
        };
      }
      return submitted(resources, index);
    });
    const deps = makeDeps({ writer: writer.port });
    installNameBridge();

    const result = await publishGalleryImage(
      ownerContext(),
      imageDraft({ id: FIXED_ID }),
      {},
      deps,
    );

    expect(result.status).toBe('partial');
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].service).toBe('THUMBNAIL');
    expect(result.indexUpdated).toBe(false);
    // The entity must never be published without its media.
    expect(writer.calls).toHaveLength(1);
  });

  it('does not retry an ambiguous media timeout automatically', async () => {
    const writer = writerFake((kind, resources, index) => {
      if (kind === 'multi' && index === 1) {
        return {
          kind: 'ambiguous',
          error: new QortalBridgeError(
            'timeout',
            'Request timed out: PUBLISH_MULTIPLE_QDN_RESOURCES',
            'PUBLISH_MULTIPLE_QDN_RESOURCES',
          ),
        };
      }
      return submitted(resources, index);
    });
    const deps = makeDeps({ writer: writer.port });
    installNameBridge();

    const result = await publishGalleryImage(
      ownerContext(),
      imageDraft({ id: FIXED_ID }),
      {},
      deps,
    );

    expect(result.status).toBe('ambiguous');
    expect(result.message).toContain('timed out');
    expect(writer.calls).toHaveLength(1);
  });

  it('does not retry an ambiguous entity timeout and explains the uncertainty', async () => {
    const writer = writerFake((kind, resources, index) => {
      if (kind === 'single' && index === 2) {
        return {
          kind: 'ambiguous',
          error: new QortalBridgeError('timeout', 'timed out', 'PUBLISH_QDN_RESOURCE'),
        };
      }
      return submitted(resources, index);
    });
    const deps = makeDeps({ writer: writer.port });
    installNameBridge();

    const result = await publishGalleryImage(
      ownerContext(),
      imageDraft({ id: FIXED_ID }),
      {},
      deps,
    );

    expect(result.status).toBe('ambiguous');
    expect(result.message).toContain('may have been published');
    expect(writer.calls).toHaveLength(2);
  });

  it('treats a failed catalog update after entity success as partial success', async () => {
    const writer = writerFake((kind, resources, index) => {
      if (kind === 'multi' && index === 3) {
        return {
          kind: 'failed',
          error: new QortalBridgeError('error', 'Index rejected', 'PUBLISH_MULTIPLE_QDN_RESOURCES'),
          failures: [
            {
              service: 'DOCUMENT',
              identifier: 'saw_cat_manifest',
              name: PUBLISHER,
              reason: 'Index rejected',
            },
          ],
        };
      }
      return submitted(resources, index);
    });
    const deps = makeDeps({ writer: writer.port });
    installNameBridge();

    const result = await publishGalleryImage(
      ownerContext(),
      imageDraft({ id: FIXED_ID }),
      {},
      deps,
    );

    expect(result.status).toBe('index-incomplete');
    expect(result.indexUpdated).toBe(false);
    expect(result.entityIdentifier).toBe(`saw_img_${FIXED_ID}`);
    expect(result.submissions.length).toBeGreaterThan(0);
    expect(result.message).toContain('index update incomplete');
  });

  it('reports the index step as unconfirmed when it times out', async () => {
    const writer = writerFake((kind, resources, index) => {
      if (kind === 'multi' && index === 3) {
        return {
          kind: 'ambiguous',
          error: new QortalBridgeError('timeout', 'timed out', 'PUBLISH_MULTIPLE_QDN_RESOURCES'),
        };
      }
      return submitted(resources, index);
    });
    const deps = makeDeps({ writer: writer.port });
    installNameBridge();

    const result = await publishGalleryImage(
      ownerContext(),
      imageDraft({ id: FIXED_ID }),
      {},
      deps,
    );

    expect(result.status).toBe('index-incomplete');
    expect(result.message).toContain('unconfirmed');
  });
});

/* -------------------------------------------------------------------------- */
/* Cache invalidation / verification                                          */
/* -------------------------------------------------------------------------- */

describe('publishGalleryImage — cache and verification', () => {
  it('invalidates the entity and catalog cache after a publication', async () => {
    const cache = memoryCache({
      [`entity:${PUBLISHER.toLowerCase()}:saw_img_${FIXED_ID}`]: { stale: true },
      [`catalog:${PUBLISHER.toLowerCase()}:manifest`]: { stale: true },
      [`catalog:${PUBLISHER.toLowerCase()}:partition:saw_cat_img_p000`]: { stale: true },
    });
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port, cache });
    installNameBridge();

    await publishGalleryImage(ownerContext(), imageDraft({ id: FIXED_ID }), {}, deps);

    expect(cache.deleted).toContain(`entity:${PUBLISHER.toLowerCase()}:saw_img_${FIXED_ID}`);
    expect(cache.deleted).toContain(`catalog:${PUBLISHER.toLowerCase()}:manifest`);
    expect(cache.deleted).toContain(
      `catalog:${PUBLISHER.toLowerCase()}:partition:saw_cat_img_p000`,
    );
  });

  it('confirms the entity and reports the item as available when a bounded read finds it', async () => {
    const reader = readerWithResources([
      { service: 'DOCUMENT', name: PUBLISHER, identifier: `saw_img_${FIXED_ID}` },
    ]);
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port, reader });
    installNameBridge();

    const result = await publishGalleryImage(
      ownerContext(),
      imageDraft({ id: FIXED_ID }),
      {},
      deps,
    );

    expect(result.entityConfirmed).toBe(true);
    expect(result.message).toContain('available');
  });

  it('verifies the exact served payload against the intended entity', async () => {
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });
    installNameBridge();
    const published = await publishGalleryImage(
      ownerContext(),
      imageDraft({ id: FIXED_ID }),
      {},
      deps,
    );

    const reader = readerWithResources([
      {
        service: 'DOCUMENT',
        name: PUBLISHER,
        identifier: `saw_img_${FIXED_ID}`,
        text: JSON.stringify(published.entityPayload),
      },
      { service: 'IMAGE', name: PUBLISHER, identifier: `saw_img_media_${FIXED_ID}` },
      { service: 'THUMBNAIL', name: PUBLISHER, identifier: `saw_img_thumb_${FIXED_ID}` },
    ]);

    const verification = await verifyGalleryPublication(
      {
        kind: 'gallery-item',
        id: FIXED_ID,
        publisherName: PUBLISHER,
        expectedEntityPayload: published.entityPayload,
      },
      makeDeps({ reader }),
    );

    expect(verification.summary).toBe('confirmed');
    expect(verification.contentMatches).toBe(true);
  });

  it('reports missing when the served payload cannot be found', async () => {
    const verification = await verifyGalleryPublication(
      { kind: 'gallery-item', id: FIXED_ID, publisherName: PUBLISHER },
      makeDeps({ reader: readerWithResources([]) }),
    );

    expect(verification.summary).toBe('missing');
    expect(verification.entity.present).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* Explicit error surface (UI must never call qortalRequest directly)         */
/* -------------------------------------------------------------------------- */

describe('GalleryPublishError', () => {
  it('carries a stable machine-readable code for the modal to render', () => {
    const error = new GalleryPublishError('invalid-input', 'A title is required.');
    expect(error.code).toBe('invalid-input');
    expect(error.name).toBe('GalleryPublishError');
  });
});

describe('album catalog entry helper', () => {
  it('builds an album entity id from the stable id', () => {
    const album = validateEntityPayload(
      {
        schemaVersion: 1,
        kind: 'gallery-album',
        id: FIXED_ID,
        publisher: PUBLISHER,
        createdAt: NOW,
        updatedAt: NOW,
        state: 'active',
        data: {
          title: 'Album',
          description: '',
          coverThumbnail: null,
          categories: [],
          tags: [],
          language: 'en',
        },
      },
      { expectedKind: 'gallery-album' },
    );
    if (!album.ok) throw new Error('fixture invalid');
    const entry = catalogEntryFromGalleryAlbum(album.value as GalleryAlbum, null);
    expect(entry.identifier).toBe(`saw_album_${FIXED_ID}`);
  });
});
