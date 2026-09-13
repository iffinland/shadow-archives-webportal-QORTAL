import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeEnvironment } from '../test/environment';
import { createRecordingReader, makeSearchHit } from '../test/fixtures/qdn';
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
import type { CachePutOptions, CacheRecord, ContentCache } from './cache';
import type { ImageProcessingDeps } from './imageProcessing';
import type { QdnReadPort, QdnSearchHit } from './qdnReader';
import { loadCatalog } from './catalogRepository';
import { loadEntityDetail } from './contentRepository';
import {
  buildQtubeVideoMetadata,
  isValidQtubeVideoMetadata,
  qtubeMetadataIdentifier,
  qtubeVideoIdentifier,
} from './qtubeVideoContract';
import {
  createVideoPublishDeps,
  publishVideo,
  sanitizeVideoFileName,
  verifyVideoPublication,
  videoSlugFromTitle,
  VideoPublishError,
  type OwnerWriteContext,
  type VideoPublishDeps,
  type VideoPublishDraft,
} from './videoPublishService';

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

function posterFile(name = 'poster.png'): File {
  return new File([PNG_HEADER], name, { type: 'image/png' });
}

const MP4_HEADER = new Uint8Array([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32,
]);

function videoFile(name = 'harbour.mp4', bytes = 8192): File {
  const body = new Uint8Array(Math.max(1024, bytes));
  body.set(MP4_HEADER, 0);
  return new File([body], name, { type: 'video/mp4' });
}

/** A tiny file that merely *reports* an over-limit size (never allocates 2 GB). */
function oversizedVideoFile(): File {
  const file = videoFile('huge.mp4', 4096);
  Object.defineProperty(file, 'size', { value: 2_000 * 1024 * 1024 + 1 });
  return file;
}

function videoDraft(overrides: Partial<VideoPublishDraft> = {}): VideoPublishDraft {
  return {
    video: videoFile(),
    poster: posterFile(),
    title: 'Harbour at dusk',
    description: 'A wide shot from the pier.',
    categories: ['Qortal'],
    tags: ['sunset'],
    language: 'en',
    durationSeconds: 42.5,
    ...overrides,
  };
}

/** Deterministic poster deps: no canvas, no real decoding, predictable sizes. */
function fakeImageDeps(options: { width?: number; height?: number } = {}): ImageProcessingDeps {
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

function makeDeps(overrides: Partial<VideoPublishDeps> = {}): VideoPublishDeps {
  return createVideoPublishDeps({
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

describe('publishVideo — authority', () => {
  it('refuses a non-owner capability without any write', async () => {
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });

    await expect(
      publishVideo(ownerContext({ capability: 'visitor' }), videoDraft(), {}, deps),
    ).rejects.toMatchObject({ code: 'not-owner' });
    expect(writer.calls).toHaveLength(0);
  });

  it('refuses a runtime that is not a real Qortal host without any write', async () => {
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });

    await expect(
      publishVideo(
        ownerContext({ environment: makeEnvironment({ publisherName: PUBLISHER }) }),
        videoDraft(),
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

    await expect(publishVideo(ownerContext(), videoDraft(), {}, deps)).rejects.toMatchObject({
      code: 'authority-changed',
    });
    expect(writer.calls).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Input validation (fail closed before any write)                            */
/* -------------------------------------------------------------------------- */

describe('publishVideo — input validation', () => {
  it('rejects a missing title, language or duration before any write', async () => {
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });

    await expect(
      publishVideo(ownerContext(), videoDraft({ title: '  ' }), {}, deps),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(
      publishVideo(ownerContext(), videoDraft({ language: '' }), {}, deps),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(
      publishVideo(ownerContext(), videoDraft({ durationSeconds: 0 }), {}, deps),
    ).rejects.toMatchObject({ code: 'invalid-input' });
    expect(writer.calls).toHaveLength(0);
  });

  it('rejects an oversized or unsupported video container before any write', async () => {
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });

    await expect(
      publishVideo(ownerContext(), videoDraft({ video: oversizedVideoFile() }), {}, deps),
    ).rejects.toMatchObject({ code: 'invalid-input' });

    await expect(
      publishVideo(
        ownerContext(),
        videoDraft({
          video: new File([new Uint8Array(4096)], 'movie.mkv', { type: 'video/x-matroska' }),
        }),
        {},
        deps,
      ),
    ).rejects.toThrow(/mkv/);
    expect(writer.calls).toHaveLength(0);
  });

  it('refuses to publish a Q-Tube artifact that would fail the interoperability gate', async () => {
    // A poster that fails the image pipeline is refused with a truthful code.
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
    await expect(publishVideo(ownerContext(), videoDraft(), {}, deps)).rejects.toMatchObject({
      code: 'poster-processing',
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Publication                                                                */
/* -------------------------------------------------------------------------- */

describe('publishVideo — publication', () => {
  it('publishes media+poster, entity+Q-Tube metadata and the derived index in three truthful stages', async () => {
    installNameBridge();
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });

    const result = await publishVideo(ownerContext(), videoDraft(), {}, deps);

    expect(result.status).toBe('published');
    expect(result.indexUpdated).toBe(true);
    expect(result.publisherName).toBe(PUBLISHER);
    // This read fixture serves no resources, so the bounded post-write read
    // cannot confirm availability yet: the result must say so, not claim it.
    expect(result.entityConfirmed).toBe(false);
    expect(result.message).toMatch(/availability is still being confirmed/i);

    const id = result.id;
    expect(id).toMatch(/^[0-9a-z]{12}$/);
    expect(result.entityIdentifier).toBe(`saw_vid_${id}`);
    expect(result.videoIdentifier).toBe(`qtube_vid_${id}`);
    expect(result.metadataIdentifier).toBe(`qtube_vid_${id}_metadata`);
    expect(result.thumbnailIdentifier).toBe(`saw_vid_thumb_${id}`);

    // Stage order: media+poster, entity+metadata, catalog partition+manifest.
    expect(writer.calls.map((call) => call.kind)).toEqual(['multi', 'multi', 'multi']);

    const [videoResource, posterResource] = writer.calls[0].resources;
    expect(videoResource.service).toBe('VIDEO');
    expect(videoResource.identifier).toBe(`qtube_vid_${id}`);
    expect(videoResource.name).toBe(PUBLISHER);
    expect(videoResource.file).toBeInstanceOf(Blob);
    expect(videoResource.data64).toBeUndefined();
    expect(videoResource.filename).toBe('harbour.mp4');
    expect(videoResource.tags).toEqual(['qtube_vid_']);
    expect(videoResource.title).toBe('Harbour at dusk');

    expect(posterResource.service).toBe('THUMBNAIL');
    expect(posterResource.identifier).toBe(`saw_vid_thumb_${id}`);
    expect(typeof data64Of(posterResource)).toBe('string');

    const [entityResource, metadataResource] = writer.calls[1].resources;
    expect(entityResource.service).toBe('DOCUMENT');
    expect(entityResource.identifier).toBe(`saw_vid_${id}`);
    expect(entityResource.tags).toEqual(['sunset']);

    expect(metadataResource.service).toBe('DOCUMENT');
    expect(metadataResource.identifier).toBe(`qtube_vid_${id}_metadata`);
    expect(metadataResource.filename).toBe('video_metadata.json');
    expect(metadataResource.tags).toEqual(['qtube_vid_']);
    expect(metadataResource.title?.length).toBeLessThanOrEqual(50);
    expect(metadataResource.description?.startsWith('**category:26;subcategory:;code:')).toBe(true);

    // The catalog pair carries a video entry for this publication.
    const [partitionResource, manifestResource] = writer.calls[2].resources;
    expect(partitionResource.identifier).toBe('saw_cat_vid_p000');
    expect(manifestResource.identifier).toBe('saw_cat_manifest');
    const partition = validateCatalogPartition(decodePayload(data64Of(partitionResource)));
    expect(partition.ok).toBe(true);
    if (partition.ok) {
      expect(partition.value.type).toBe('video');
      expect(partition.value.listings.map((listing) => listing.id)).toContain(id);
      expect(partition.value.listings[0]).toMatchObject({ type: 'video', durationSeconds: 42.5 });
    }
    const manifest = validateCatalogManifest(decodePayload(data64Of(manifestResource)));
    expect(manifest.ok).toBe(true);
  });

  it("writes an authoritative entity that validates and a Q-Tube artifact that passes Q-Tube's own gate", async () => {
    installNameBridge();
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });

    const result = await publishVideo(
      ownerContext(),
      videoDraft({ categories: ['Qortal', 'Archive'], tags: ['a', 'b'] }),
      {},
      deps,
    );

    const entityResource = writer.calls[1].resources[0];
    const entity = validateEntityPayload(decodePayload(data64Of(entityResource)), {
      expectedKind: 'video',
    });
    expect(entity.ok).toBe(true);
    if (entity.ok && entity.value.kind === 'video') {
      expect(entity.value.data.media).toMatchObject({
        service: 'VIDEO',
        name: PUBLISHER,
        identifier: `qtube_vid_${result.id}`,
      });
      expect(entity.value.data.thumbnail).toMatchObject({
        service: 'THUMBNAIL',
        identifier: `saw_vid_thumb_${result.id}`,
      });
      expect(entity.value.data.durationSeconds).toBe(42.5);
      expect(entity.value.data.slug).toBe('harbour-at-dusk');
    }

    const metadataResource = writer.calls[1].resources[1];
    const served = decodePayload(data64Of(metadataResource));
    expect(isValidQtubeVideoMetadata(served)).toBe(true);
    expect(served).toMatchObject({
      version: 1,
      category: '26',
      subcategory: '',
      videoType: 'video/mp4',
      filename: 'harbour.mp4',
      duration: 42.5,
      videoReference: {
        name: PUBLISHER,
        identifier: `qtube_vid_${result.id}`,
        service: 'VIDEO',
      },
    });
    expect(String((served as { videoImage: string }).videoImage).startsWith('data:image/')).toBe(
      true,
    );
    expect((served as { extracts: unknown[] }).extracts).toHaveLength(1);
  });

  it('reuses a supplied id so a retry cannot mint a duplicate', async () => {
    installNameBridge();
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });

    const first = await publishVideo(ownerContext(), videoDraft({ id: FIXED_ID }), {}, deps);
    expect(first.id).toBe(FIXED_ID);
    expect(first.videoIdentifier).toBe(`qtube_vid_${FIXED_ID}`);
    expect(first.metadataIdentifier).toBe(`qtube_vid_${FIXED_ID}_metadata`);

    const second = await publishVideo(ownerContext(), videoDraft({ id: FIXED_ID }), {}, deps);
    expect(second.videoIdentifier).toBe(first.videoIdentifier);
    expect(second.metadataIdentifier).toBe(first.metadataIdentifier);
    expect(second.entityIdentifier).toBe(first.entityIdentifier);
  });

  it('confirms the entity with a bounded read when the node already serves it', async () => {
    installNameBridge();
    const writer = writerFake();
    const reader = readerWithResources([
      { service: 'DOCUMENT', name: PUBLISHER, identifier: `saw_vid_${FIXED_ID}`, status: 'READY' },
    ]);
    const deps = makeDeps({ writer: writer.port, reader });

    const result = await publishVideo(ownerContext(), videoDraft({ id: FIXED_ID }), {}, deps);

    expect(result.status).toBe('published');
    expect(result.entityConfirmed).toBe(true);
    expect(result.message).toMatch(/Published\./);
  });

  it('reports a partial metadata stage truthfully and never retries it automatically', async () => {
    installNameBridge();
    const writer = writerFake((kind, resources, callIndex) => {
      if (kind === 'multi' && callIndex === 2) {
        const failures: PublishFailure[] = [
          {
            service: 'DOCUMENT',
            identifier: `qtube_vid_${FIXED_ID}_metadata`,
            name: PUBLISHER,
            reason: 'insufficient funds',
          },
        ];
        return {
          kind: 'partial',
          submissions: [submissionFor(resources[0], callIndex)],
          failures,
        };
      }
      return submitted(resources, callIndex);
    });
    const deps = makeDeps({ writer: writer.port });

    const result = await publishVideo(ownerContext(), videoDraft({ id: FIXED_ID }), {}, deps);

    expect(result.status).toBe('partial');
    expect(result.indexUpdated).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.message).toMatch(/video file is published/i);
    expect(result.message).toMatch(/no duplicate video is created/i);
    // The exact coordinates of every resource survive the partial result, so the
    // owner (or a later retry) can verify/recover rather than guess.
    expect(result.videoIdentifier).toBe(`qtube_vid_${FIXED_ID}`);
    expect(result.thumbnailIdentifier).toBe(`saw_vid_thumb_${FIXED_ID}`);
    expect(result.entityIdentifier).toBe(`saw_vid_${FIXED_ID}`);
    expect(result.metadataIdentifier).toBe(`qtube_vid_${FIXED_ID}_metadata`);
    expect(result.failures[0].identifier).toBe(`qtube_vid_${FIXED_ID}_metadata`);
    expect(result.entityPayload).toBeTruthy();
    // Exactly two write calls: the failed metadata stage is never retried.
    expect(writer.calls).toHaveLength(2);
  });

  it('treats a metadata-stage timeout as ambiguous and preserves the exact identity', async () => {
    installNameBridge();
    const writer = writerFake((kind, resources, callIndex) => {
      if (kind === 'multi' && callIndex === 2) {
        return {
          kind: 'ambiguous',
          error: new QortalBridgeError(
            'timeout',
            'Request timed out',
            'PUBLISH_MULTIPLE_QDN_RESOURCES',
          ),
        };
      }
      return submitted(resources, callIndex);
    });
    const deps = makeDeps({ writer: writer.port });

    const result = await publishVideo(ownerContext(), videoDraft({ id: FIXED_ID }), {}, deps);

    expect(result.status).toBe('ambiguous');
    expect(result.message).toMatch(/timed out/i);
    expect(result.videoIdentifier).toBe(`qtube_vid_${FIXED_ID}`);
    expect(result.metadataIdentifier).toBe(`qtube_vid_${FIXED_ID}_metadata`);
    expect(writer.calls).toHaveLength(2);
  });

  it('treats a media-stage timeout as ambiguous and never writes metadata afterwards', async () => {
    installNameBridge();
    const writer = writerFake((kind, resources, callIndex) => {
      if (kind === 'multi' && callIndex === 1) {
        return {
          kind: 'ambiguous',
          error: new QortalBridgeError(
            'timeout',
            'Request timed out',
            'PUBLISH_MULTIPLE_QDN_RESOURCES',
          ),
        };
      }
      return submitted(resources, callIndex);
    });
    const deps = makeDeps({ writer: writer.port });

    const result = await publishVideo(ownerContext(), videoDraft({ id: FIXED_ID }), {}, deps);

    expect(result.status).toBe('ambiguous');
    expect(writer.calls).toHaveLength(1);
  });

  it('reports an index-only failure as index-incomplete while the content stays published', async () => {
    installNameBridge();
    const writer = writerFake((kind, resources, callIndex) => {
      if (kind === 'multi' && callIndex === 3) {
        return {
          kind: 'failed',
          error: new QortalBridgeError('error', 'index rejected', 'PUBLISH_MULTIPLE_QDN_RESOURCES'),
          failures: [
            {
              service: 'DOCUMENT',
              identifier: 'saw_cat_vid_p000',
              name: PUBLISHER,
              reason: 'index rejected',
            },
          ],
        };
      }
      return submitted(resources, callIndex);
    });
    const deps = makeDeps({ writer: writer.port });

    const result = await publishVideo(ownerContext(), videoDraft({ id: FIXED_ID }), {}, deps);

    expect(result.status).toBe('index-incomplete');
    expect(result.message).toMatch(/index update incomplete/i);
    expect(result.indexUpdated).toBe(false);
    // The authoritative entity was still submitted (its exact identity survives).
    expect(result.entityPayload).toBeTruthy();
    expect(writer.calls).toHaveLength(3);
  });

  it('skips the derived index (and says so) when the index cannot be read, without blocking the content write', async () => {
    installNameBridge();
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port, reader: failingReader('index unreadable') });

    const result = await publishVideo(ownerContext(), videoDraft({ id: FIXED_ID }), {}, deps);

    expect(result.status).toBe('index-incomplete');
    expect(result.message).toMatch(/index/i);
    // Only the two content stages ran; no catalog write was attempted.
    expect(writer.calls).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */
/* Verification                                                               */
/* -------------------------------------------------------------------------- */

interface PublicationPayloads {
  readonly id: string;
  readonly discovery?: 'found' | 'absent' | 'error';
}

function verifyReader(options: PublicationPayloads) {
  const entityIdentifier = `saw_vid_${options.id}`;
  const videoIdentifier = qtubeVideoIdentifier(options.id);
  const thumbnailIdentifier = `saw_vid_thumb_${options.id}`;
  const metadataIdentifier = qtubeMetadataIdentifier(options.id);

  const entityPayload = {
    schemaVersion: 1,
    kind: 'video',
    id: options.id,
    publisher: PUBLISHER,
    createdAt: NOW,
    updatedAt: NOW,
    state: 'active',
    data: {
      title: 'Harbour at dusk',
      slug: 'harbour-at-dusk',
      description: 'A wide shot from the pier.',
      media: {
        service: 'VIDEO',
        name: PUBLISHER,
        identifier: videoIdentifier,
        mimeType: 'video/mp4',
      },
      externalMedia: null,
      thumbnail: { service: 'THUMBNAIL', name: PUBLISHER, identifier: thumbnailIdentifier },
      durationSeconds: 42.5,
      categories: ['Qortal'],
      tags: ['sunset'],
      language: 'en',
    },
  };
  const metadataPayload = buildQtubeVideoMetadata({
    title: 'Harbour at dusk',
    description: 'A wide shot from the pier.',
    thumbnailDataUrl: 'data:image/webp;base64,AAAA',
    media: { name: PUBLISHER, identifier: videoIdentifier, service: 'VIDEO' },
    categoryId: 26,
    code: options.id.slice(0, 5),
    videoType: 'video/mp4',
    filename: 'harbour.mp4',
    fileSize: 8192,
    durationSeconds: 42.5,
  });

  const reader = createRecordingReader(
    (request) => {
      if (request.identifier === 'qtube_vid_') {
        if (options.discovery === 'error') {
          throw new QortalBridgeError('error', 'search unavailable', 'SEARCH_QDN_RESOURCES');
        }
        if (options.discovery === 'absent') {
          return [makeSearchHit('DOCUMENT', PUBLISHER, 'qtube_vid_zzzzzzzzzzzz_metadata')];
        }
        return [makeSearchHit('DOCUMENT', PUBLISHER, metadataIdentifier)];
      }
      const identifier = request.defaultResource ? null : (request.identifier ?? null);
      const service = String(request.service ?? '');
      if (service === 'DOCUMENT' && identifier === entityIdentifier) {
        return [makeSearchHit('DOCUMENT', PUBLISHER, entityIdentifier)];
      }
      if (service === 'VIDEO' && identifier === videoIdentifier) {
        return [makeSearchHit('VIDEO', PUBLISHER, videoIdentifier)];
      }
      if (service === 'THUMBNAIL' && identifier === thumbnailIdentifier) {
        return [makeSearchHit('THUMBNAIL', PUBLISHER, thumbnailIdentifier)];
      }
      if (service === 'DOCUMENT' && identifier === metadataIdentifier) {
        return [makeSearchHit('DOCUMENT', PUBLISHER, metadataIdentifier)];
      }
      return [];
    },
    (ref) => {
      if (ref.identifier === entityIdentifier) return JSON.stringify(entityPayload);
      if (ref.identifier === metadataIdentifier) return JSON.stringify(metadataPayload);
      throw new QortalBridgeError('error', 'Resource not found', 'FETCH_QDN_RESOURCE');
    },
  );

  return {
    reader,
    entityIdentifier,
    videoIdentifier,
    thumbnailIdentifier,
    metadataIdentifier,
    entityPayload,
  };
}

describe('verifyVideoPublication', () => {
  it('confirms all four resources, the payload match and the Q-Tube discovery query', async () => {
    const fixture = verifyReader({ id: FIXED_ID, discovery: 'found' });
    const deps = makeDeps({ reader: fixture.reader });

    const result = await verifyVideoPublication(
      { id: FIXED_ID, publisherName: PUBLISHER, expectedEntityPayload: fixture.entityPayload },
      deps,
    );

    expect(result.summary).toBe('confirmed');
    expect(result.contentMatches).toBe(true);
    expect(result.qtubeMetadataValid).toBe(true);
    expect(result.qtubeReferenceMatches).toBe(true);
    expect(result.qtubeDiscovery).toMatchObject({ found: true });
    expect(result.entityIdentifier).toBe(fixture.entityIdentifier);
    expect(result.videoIdentifier).toBe(`qtube_vid_${FIXED_ID}`);
    expect(result.metadataIdentifier).toBe(`qtube_vid_${FIXED_ID}_metadata`);
  });

  it('reports missing resources as missing rather than confirmed', async () => {
    const deps = makeDeps({ reader: readerWithResources([]) });

    const result = await verifyVideoPublication({ id: FIXED_ID, publisherName: PUBLISHER }, deps);

    expect(result.summary).toBe('missing');
    expect(result.entity.present).toBe(false);
    expect(result.video.present).toBe(false);
    expect(result.qtubeMetadataValid).toBeNull();
  });

  it('reports a failing discovery search as unknown instead of fabricating a result', async () => {
    const fixture = verifyReader({ id: FIXED_ID, discovery: 'error' });
    const deps = makeDeps({ reader: fixture.reader });

    const result = await verifyVideoPublication({ id: FIXED_ID, publisherName: PUBLISHER }, deps);

    expect(result.qtubeDiscovery.found).toBeNull();
    expect(result.qtubeDiscovery.note).toBeTruthy();
    // The resources themselves are still confirmed.
    expect(result.summary).toBe('submitted-unconfirmed');
  });

  it('reports a publication that the Q-Tube query does not return yet', async () => {
    const fixture = verifyReader({ id: FIXED_ID, discovery: 'absent' });
    const deps = makeDeps({ reader: fixture.reader });

    const result = await verifyVideoPublication({ id: FIXED_ID, publisherName: PUBLISHER }, deps);

    expect(result.qtubeDiscovery.found).toBe(false);
    expect(result.qtubeDiscovery.note).toMatch(/lag/i);
  });
});

/* -------------------------------------------------------------------------- */
/* Naming helpers                                                             */
/* -------------------------------------------------------------------------- */

describe('video naming helpers', () => {
  it('never produces an empty Q-Tube filename', () => {
    expect(sanitizeVideoFileName('harbour clip.mov', FIXED_ID)).toBe('harbour_clip.mov');
    expect(sanitizeVideoFileName('   ', FIXED_ID)).toBe(`saw-video-${FIXED_ID}.mp4`);
    expect(sanitizeVideoFileName('/tmp/../weird name!.mkv', FIXED_ID)).toBe('weird_name_.mkv');
  });

  it('always produces a slug the entity validator accepts', () => {
    expect(videoSlugFromTitle('Harbour at dusk', FIXED_ID)).toBe('harbour-at-dusk');
    expect(videoSlugFromTitle('!!!', FIXED_ID)).toBe(`video-${FIXED_ID}`);
  });
});

/* -------------------------------------------------------------------------- */
/* Readback through the normal read pipeline                                  */
/* -------------------------------------------------------------------------- */

describe('published video is readable through the app read path', () => {
  it('validates as an entity and loads through loadEntityDetail/loadCatalog', async () => {
    installNameBridge();
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });

    const result = await publishVideo(ownerContext(), videoDraft({ id: FIXED_ID }), {}, deps);

    const entityResource = writer.calls[1].resources[0];
    const entityText = atob(data64Of(entityResource));
    const serverReader = readerWithResources([
      {
        service: 'DOCUMENT',
        name: PUBLISHER,
        identifier: `saw_vid_${FIXED_ID}`,
        text: entityText,
      },
    ]);

    const detail = await loadEntityDetail(
      { scoped: true, name: PUBLISHER, service: 'DOCUMENT' },
      'video',
      FIXED_ID,
      {
        reader: serverReader,
        cache: memoryCache(),
        now: NOW,
      },
    );
    expect(detail.entity?.kind).toBe('video');
    expect(detail.entity?.data.title).toBe('Harbour at dusk');

    const catalog = await loadCatalog(serverReader, memoryCache(), PUBLISHER, { now: NOW });
    expect(catalog.kind).not.toBe('error');
    expect(result.id).toBe(FIXED_ID);
  });
});

describe('published video catalog round-trip', () => {
  it('writes an index the read pipeline loads as a video listing', async () => {
    installNameBridge();
    const writer = writerFake();
    const deps = makeDeps({ writer: writer.port });

    await publishVideo(ownerContext(), videoDraft({ id: FIXED_ID }), {}, deps);

    const [partitionResource, manifestResource] = writer.calls[2].resources;
    const reader = readerWithResources([
      {
        service: 'DOCUMENT',
        name: PUBLISHER,
        identifier: 'saw_cat_manifest',
        text: atob(data64Of(manifestResource)),
      },
      {
        service: 'DOCUMENT',
        name: PUBLISHER,
        identifier: 'saw_cat_vid_p000',
        text: atob(data64Of(partitionResource)),
      },
    ]);

    const catalog = await loadCatalog(reader, memoryCache(), PUBLISHER, { now: NOW });

    expect(catalog.kind).toBe('loaded');
    if (catalog.kind !== 'loaded') return;
    const listing = catalog.listings.find((entry) => entry.id === FIXED_ID);
    expect(listing).toMatchObject({
      type: 'video',
      title: 'Harbour at dusk',
      durationSeconds: 42.5,
    });
    expect(listing?.thumbnail).toMatchObject({
      service: 'THUMBNAIL',
      name: PUBLISHER,
      identifier: `saw_vid_thumb_${FIXED_ID}`,
    });
    // The listing's card can be built without any Q-Tube metadata read.
    expect(catalog.listings.every((entry) => !entry.identifier.includes('qtube'))).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Error type                                                                 */
/* -------------------------------------------------------------------------- */

describe('VideoPublishError', () => {
  it('carries a stable code for the owner-facing taxonomy', () => {
    const error = new VideoPublishError('not-owner', 'Nope');
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('VideoPublishError');
    expect(error.code).toBe('not-owner');
  });
});
