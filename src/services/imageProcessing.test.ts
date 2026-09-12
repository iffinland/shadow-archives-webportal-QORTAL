import { describe, expect, it } from 'vitest';

import { GALLERY_MEDIA_POLICY, planScale } from '../domain/galleryMedia';
import {
  assertUsableImageSource,
  ImageProcessingError,
  processGalleryImage,
  sniffImageFormat,
  type ImageProcessingDeps,
} from './imageProcessing';

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const JPEG = new Uint8Array([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);

function file(bytes: Uint8Array<ArrayBuffer>, name: string, type: string): File {
  return new File([bytes], name, { type });
}

interface FakeOptions {
  readonly width?: number;
  readonly height?: number;
  readonly fullBytes?: number;
  readonly thumbnailBytes?: number;
  readonly fullMime?: string;
}

/** Deterministic pipeline: no real canvas, no real encoder, exact byte sizes. */
function fakeDeps(options: FakeOptions = {}): ImageProcessingDeps {
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
      if (thumbnail) {
        return new Blob([new Uint8Array(options.thumbnailBytes ?? 2048)], { type });
      }
      const size =
        options.fullBytes ?? Math.max(64, Math.round((target.width * target.height) / 64));
      return new Blob([new Uint8Array(size)], {
        type: options.fullMime ?? type,
      });
    },
  };
}

describe('sniffImageFormat', () => {
  it('detects JPEG, PNG and WebP from magic bytes only', () => {
    expect(sniffImageFormat(JPEG)).toBe('image/jpeg');
    expect(sniffImageFormat(PNG)).toBe('image/png');
    expect(sniffImageFormat(WEBP)).toBe('image/webp');
  });

  it('returns null for bytes that are not a supported still image', () => {
    expect(sniffImageFormat(new TextEncoder().encode('plain text file'))).toBeNull();
    expect(sniffImageFormat(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBeNull();
    expect(sniffImageFormat(new Uint8Array())).toBeNull();
  });
});

describe('assertUsableImageSource', () => {
  it('accepts the supported source formats', async () => {
    await expect(assertUsableImageSource(file(PNG, 'a.png', 'image/png'))).resolves.toBe(
      'image/png',
    );
    await expect(assertUsableImageSource(file(JPEG, 'a.jpg', 'image/jpeg'))).resolves.toBe(
      'image/jpeg',
    );
    await expect(assertUsableImageSource(file(WEBP, 'a.webp', 'image/webp'))).resolves.toBe(
      'image/webp',
    );
    await expect(assertUsableImageSource(file(PNG, 'a.bin', ''))).resolves.toBe('image/png');
  });

  it('rejects an empty file before decoding it', async () => {
    await expect(
      assertUsableImageSource(file(new Uint8Array(), 'a.png', 'image/png')),
    ).rejects.toMatchObject({ code: 'unsupported-format' });
  });

  it('rejects a file above the in-browser processing limit', async () => {
    const oversized = {
      size: GALLERY_MEDIA_POLICY.maxSourceBytes + 1,
      type: 'image/png',
    } as unknown as File;
    await expect(assertUsableImageSource(oversized)).rejects.toMatchObject({ code: 'too-large' });
  });

  it('rejects bytes that are not a decodable still image', async () => {
    await expect(
      assertUsableImageSource(file(new TextEncoder().encode('hello'), 'a.png', 'image/png')),
    ).rejects.toMatchObject({ code: 'unsupported-format' });
  });

  it('rejects a renamed file whose declared type disagrees with its bytes', async () => {
    await expect(assertUsableImageSource(file(JPEG, 'a.png', 'image/png'))).rejects.toMatchObject({
      code: 'declared-type-mismatch',
    });
  });
});

describe('planScale', () => {
  it('never upscales an image that already fits', () => {
    expect(planScale(320, 200, 2400)).toEqual({ width: 320, height: 200, scaled: false });
  });

  it('scales the longest edge while preserving the aspect ratio', () => {
    expect(planScale(4000, 2000, 2400)).toEqual({ width: 2400, height: 1200, scaled: true });
    expect(planScale(2000, 4000, 2400)).toEqual({ width: 1200, height: 2400, scaled: true });
  });
});

describe('processGalleryImage', () => {
  it('never upscales and keeps the original bytes when re-encoding would gain nothing', async () => {
    const result = await processGalleryImage(
      file(PNG, 'small.png', 'image/png'),
      fakeDeps({ width: 320, height: 200 }),
    );

    expect(result.full.width).toBe(320);
    expect(result.full.height).toBe(200);
    expect(result.full.preservedOriginal).toBe(true);
    expect(result.full.mimeType).toBe('image/png');
    expect(result.notices.join(' ')).toContain('Kept the original file');
  });

  it('downscales a large image to the bounded full edge and reports it', async () => {
    const result = await processGalleryImage(
      file(PNG, 'large.png', 'image/png'),
      fakeDeps({ width: 3000, height: 2000 }),
    );

    expect(result.source).toMatchObject({ width: 3000, height: 2000 });
    expect(result.full.width).toBe(GALLERY_MEDIA_POLICY.full.maxEdge);
    expect(result.full.height).toBe(1600);
    expect(result.full.preservedOriginal).toBe(false);
    expect(result.notices.join(' ')).toContain('Downscaled');
  });

  it('bounds the thumbnail independently of the full image', async () => {
    const result = await processGalleryImage(
      file(PNG, 'large.png', 'image/png'),
      fakeDeps({ width: 3000, height: 2000 }),
    );

    expect(result.thumbnail.width).toBeLessThanOrEqual(GALLERY_MEDIA_POLICY.thumbnail.maxEdge);
    expect(result.thumbnail.height).toBeLessThanOrEqual(GALLERY_MEDIA_POLICY.thumbnail.maxEdge);
    expect(result.thumbnail.bytes).toBeLessThanOrEqual(
      GALLERY_MEDIA_POLICY.serviceLimits.thumbnail,
    );
  });

  it('rejects an image whose decoded dimensions exceed the pixel budget', async () => {
    await expect(
      processGalleryImage(
        file(PNG, 'huge.png', 'image/png'),
        fakeDeps({ width: 9000, height: 9000 }),
      ),
    ).rejects.toMatchObject({ code: 'too-many-pixels' });
  });

  it('rejects a decoded edge above the single-edge limit', async () => {
    await expect(
      processGalleryImage(
        file(PNG, 'wide.png', 'image/png'),
        fakeDeps({ width: 12_500, height: 400 }),
      ),
    ).rejects.toMatchObject({ code: 'too-many-pixels' });
  });

  it('fails closed when the full image cannot fit the verified IMAGE cap', async () => {
    await expect(
      processGalleryImage(
        file(PNG, 'large.png', 'image/png'),
        fakeDeps({
          width: 3000,
          height: 2000,
          fullBytes: GALLERY_MEDIA_POLICY.serviceLimits.image + 1,
        }),
      ),
    ).rejects.toMatchObject({ code: 'service-limit' });
  });

  it('fails closed when the thumbnail cannot fit the verified THUMBNAIL cap', async () => {
    await expect(
      processGalleryImage(
        file(PNG, 'large.png', 'image/png'),
        fakeDeps({
          width: 3000,
          height: 2000,
          thumbnailBytes: GALLERY_MEDIA_POLICY.serviceLimits.thumbnail + 1,
        }),
      ),
    ).rejects.toMatchObject({ code: 'service-limit' });
  });

  it('warns truthfully when the browser encodes in a different format', async () => {
    const result = await processGalleryImage(
      file(PNG, 'large.png', 'image/png'),
      fakeDeps({ width: 3000, height: 2000, fullMime: 'image/png' }),
    );

    expect(result.warnings.join(' ')).toContain('image/png');
  });

  it('surfaces an ImageProcessingError subtype for programmatic handling', async () => {
    await expect(
      processGalleryImage(file(new Uint8Array([1, 2, 3]), 'a.png', 'image/png')),
    ).rejects.toBeInstanceOf(ImageProcessingError);
  });
});
