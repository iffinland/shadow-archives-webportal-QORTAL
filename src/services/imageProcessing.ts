/**
 * In-browser Gallery image pipeline.
 *
 * Native browser APIs only (`createImageBitmap` + `canvas.toBlob`); no image
 * library is added. The output is a bounded, metadata-stripped web copy plus a
 * bounded thumbnail, both validated against the verified Core `IMAGE` /
 * `THUMBNAIL` caps before any write is attempted.
 *
 * This module is imported only from the lazy Gallery-owner boundary, so none of
 * it is part of the visitor startup graph.
 */

import {
  GALLERY_MEDIA_POLICY,
  formatByteSize,
  isSupportedGalleryImageMime,
  planScale,
  type GalleryImageSourceMime,
} from '../domain/galleryMedia';

export type ImageProcessingErrorCode =
  | 'unsupported-format'
  | 'declared-type-mismatch'
  | 'too-large'
  | 'too-many-pixels'
  | 'decode-failed'
  | 'encode-failed'
  | 'service-limit'
  | 'unsupported-environment';

export class ImageProcessingError extends Error {
  readonly code: ImageProcessingErrorCode;

  constructor(code: ImageProcessingErrorCode, message: string) {
    super(message);
    this.name = 'ImageProcessingError';
    this.code = code;
  }
}

export interface ProcessedImage {
  readonly blob: Blob;
  readonly bytes: number;
  readonly width: number;
  readonly height: number;
  readonly mimeType: string;
  /** True when the bytes are the untouched source rather than a re-encode. */
  readonly preservedOriginal: boolean;
}

export interface GalleryImageProcessingResult {
  readonly full: ProcessedImage;
  readonly thumbnail: ProcessedImage;
  readonly source: {
    readonly bytes: number;
    readonly width: number;
    readonly height: number;
    readonly mimeType: GalleryImageSourceMime;
  };
  /** Truthful, non-blocking notes shown in the modal (downscale, conversion, …). */
  readonly notices: readonly string[];
  /** Non-fatal surprises the owner should see (for example a browser format fallback). */
  readonly warnings: readonly string[];
}

interface BitmapLike {
  readonly width: number;
  readonly height: number;
  close?: () => void;
}

interface CanvasPort {
  readonly canvas: HTMLCanvasElement;
  readonly context: CanvasRenderingContext2D;
}

/** Injectable browser boundary; tests supply fakes so no real canvas is required. */
export interface ImageProcessingDeps {
  decode(file: Blob): Promise<BitmapLike>;
  createCanvas(width: number, height: number): CanvasPort;
  toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob>;
}

export const browserImageProcessingDeps: ImageProcessingDeps = {
  async decode(file) {
    if (typeof createImageBitmap !== 'function') {
      throw new ImageProcessingError(
        'unsupported-environment',
        'This browser cannot decode images in-page (createImageBitmap is unavailable).',
      );
    }
    try {
      // `from-image` honours the EXIF orientation, so a phone photo is drawn the
      // way the owner saw it instead of being silently rotated.
      return await createImageBitmap(file, { imageOrientation: 'from-image' });
    } catch {
      try {
        return await createImageBitmap(file);
      } catch {
        throw new ImageProcessingError(
          'decode-failed',
          'The selected file could not be decoded as an image.',
        );
      }
    }
  },

  createCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new ImageProcessingError(
        'unsupported-environment',
        'This browser cannot create an image canvas.',
      );
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    return { canvas, context };
  },

  toBlob(canvas, type, quality) {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (blob) resolve(blob);
          else reject(new ImageProcessingError('encode-failed', 'Image encoding failed.'));
        },
        type,
        quality,
      );
    });
  },
};

/** Magic-byte sniffing so a renamed file cannot pass on its declared MIME type alone. */
export function sniffImageFormat(header: Uint8Array): GalleryImageSourceMime | null {
  if (header.length >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff) {
    return 'image/jpeg';
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (header.length >= 8 && png.every((byte, index) => header[index] === byte)) return 'image/png';
  if (
    header.length >= 12 &&
    header[0] === 0x52 && // R
    header[1] === 0x49 && // I
    header[2] === 0x46 && // F
    header[3] === 0x46 && // F
    header[8] === 0x57 && // W
    header[9] === 0x45 && // E
    header[10] === 0x42 && // B
    header[11] === 0x50 // P
  ) {
    return 'image/webp';
  }
  return null;
}

async function readHeader(file: Blob): Promise<Uint8Array> {
  const buffer = await file.slice(0, 16).arrayBuffer();
  return new Uint8Array(buffer);
}

function drawScaled(
  deps: ImageProcessingDeps,
  bitmap: BitmapLike,
  width: number,
  height: number,
): HTMLCanvasElement {
  const { canvas, context } = deps.createCanvas(width, height);
  context.clearRect(0, 0, width, height);
  context.drawImage(
    bitmap as unknown as CanvasImageSource,
    0,
    0,
    bitmap.width,
    bitmap.height,
    0,
    0,
    width,
    height,
  );
  return canvas;
}

async function encode(
  deps: ImageProcessingDeps,
  bitmap: BitmapLike,
  maxEdge: number,
  quality: number,
  format: string,
): Promise<{ blob: Blob; width: number; height: number; scaled: boolean }> {
  const target = planScale(bitmap.width, bitmap.height, maxEdge);
  const canvas = drawScaled(deps, bitmap, target.width, target.height);
  const blob = await deps.toBlob(canvas, format, quality);
  return { blob, width: target.width, height: target.height, scaled: target.scaled };
}

/** Validate the source before decoding it, then validate the decoded dimensions. */
export async function assertUsableImageSource(file: File): Promise<GalleryImageSourceMime> {
  if (file.size <= 0) {
    throw new ImageProcessingError('unsupported-format', 'The selected file is empty.');
  }
  if (file.size > GALLERY_MEDIA_POLICY.maxSourceBytes) {
    throw new ImageProcessingError(
      'too-large',
      `The selected file is ${formatByteSize(file.size)}; the limit for in-browser processing is ${formatByteSize(GALLERY_MEDIA_POLICY.maxSourceBytes)}.`,
    );
  }

  const header = await readHeader(file);
  const detected = sniffImageFormat(header);
  if (!detected) {
    throw new ImageProcessingError(
      'unsupported-format',
      'Only JPEG, PNG and WebP still images are supported in this phase.',
    );
  }

  // A declared type is a claim; it must agree with the actual bytes. An empty
  // declared type is tolerated because the bytes were sniffed successfully.
  const declared = file.type;
  if (declared && declared !== detected) {
    throw new ImageProcessingError(
      'declared-type-mismatch',
      `The file declares ${declared} but its contents are ${detected}.`,
    );
  }
  if (declared && !isSupportedGalleryImageMime(declared)) {
    throw new ImageProcessingError(
      'unsupported-format',
      `Unsupported image type ${declared}. Supported: JPEG, PNG, WebP.`,
    );
  }
  return detected;
}

function assertDecodedDimensions(width: number, height: number): void {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new ImageProcessingError('decode-failed', 'The image reported invalid dimensions.');
  }
  const pixels = width * height;
  if (
    pixels > GALLERY_MEDIA_POLICY.maxSourcePixels ||
    width > GALLERY_MEDIA_POLICY.maxSourceEdge ||
    height > GALLERY_MEDIA_POLICY.maxSourceEdge
  ) {
    throw new ImageProcessingError(
      'too-many-pixels',
      `The image is ${width}×${height}; the processing limit is ${GALLERY_MEDIA_POLICY.maxSourcePixels.toLocaleString()} pixels and ${GALLERY_MEDIA_POLICY.maxSourceEdge} px per edge.`,
    );
  }
}

/**
 * Process one selected file into the Gallery media + thumbnail pair.
 *
 * Always returns truthful source/derived numbers. It never upscales, never
 * silently rotates, and only keeps the untouched source when re-encoding would
 * be no smaller and no downscale happened.
 */
export async function processGalleryImage(
  file: File,
  deps: ImageProcessingDeps = browserImageProcessingDeps,
): Promise<GalleryImageProcessingResult> {
  const detectedType = await assertUsableImageSource(file);
  const bitmap = await deps.decode(file);
  try {
    assertDecodedDimensions(bitmap.width, bitmap.height);

    const notices: string[] = [];
    const warnings: string[] = [];

    const fullEncode = await encode(
      deps,
      bitmap,
      GALLERY_MEDIA_POLICY.full.maxEdge,
      GALLERY_MEDIA_POLICY.full.quality,
      GALLERY_MEDIA_POLICY.full.format,
    );
    if (fullEncode.scaled) {
      notices.push(
        `Downscaled to ${fullEncode.width}×${fullEncode.height} px (longest edge ${GALLERY_MEDIA_POLICY.full.maxEdge} px).`,
      );
    }
    if (fullEncode.blob.type !== GALLERY_MEDIA_POLICY.full.format) {
      warnings.push(
        `The browser encoded the full image as ${fullEncode.blob.type || 'an unknown type'} instead of ${GALLERY_MEDIA_POLICY.full.format}.`,
      );
    }

    let fullBlob = fullEncode.blob;
    let preservedOriginal = false;
    // Keep the owner's original bytes when re-encoding gains nothing: an already
    // small, already web-format image must not be made heavier or lossier.
    const reencodeSavesAtLeast5Percent = fullEncode.blob.size <= file.size * 0.95;
    const declaredAgrees = file.type.length === 0 || file.type === detectedType;
    if (
      !fullEncode.scaled &&
      declaredAgrees &&
      file.size <= GALLERY_MEDIA_POLICY.serviceLimits.image &&
      !reencodeSavesAtLeast5Percent
    ) {
      fullBlob = file;
      preservedOriginal = true;
      notices.push('Kept the original file: re-encoding would not have reduced its size.');
    }

    if (fullBlob.size > GALLERY_MEDIA_POLICY.serviceLimits.image) {
      throw new ImageProcessingError(
        'service-limit',
        `The processed image is ${formatByteSize(fullBlob.size)}, above the Qortal IMAGE limit of ${formatByteSize(GALLERY_MEDIA_POLICY.serviceLimits.image)}.`,
      );
    }

    const thumbEncode = await encode(
      deps,
      bitmap,
      GALLERY_MEDIA_POLICY.thumbnail.maxEdge,
      GALLERY_MEDIA_POLICY.thumbnail.quality,
      GALLERY_MEDIA_POLICY.thumbnail.format,
    );
    if (thumbEncode.blob.type !== GALLERY_MEDIA_POLICY.thumbnail.format) {
      warnings.push(
        `The browser encoded the thumbnail as ${thumbEncode.blob.type || 'an unknown type'}.`,
      );
    }
    if (thumbEncode.blob.size > GALLERY_MEDIA_POLICY.serviceLimits.thumbnail) {
      throw new ImageProcessingError(
        'service-limit',
        `The generated thumbnail is ${formatByteSize(thumbEncode.blob.size)}, above the Qortal THUMBNAIL limit of ${formatByteSize(GALLERY_MEDIA_POLICY.serviceLimits.thumbnail)}.`,
      );
    }

    return {
      full: {
        blob: fullBlob,
        bytes: fullBlob.size,
        width: preservedOriginal ? bitmap.width : fullEncode.width,
        height: preservedOriginal ? bitmap.height : fullEncode.height,
        mimeType: preservedOriginal
          ? detectedType
          : fullBlob.type || GALLERY_MEDIA_POLICY.full.format,
        preservedOriginal,
      },
      thumbnail: {
        blob: thumbEncode.blob,
        bytes: thumbEncode.blob.size,
        width: thumbEncode.width,
        height: thumbEncode.height,
        mimeType: thumbEncode.blob.type || GALLERY_MEDIA_POLICY.thumbnail.format,
        preservedOriginal: false,
      },
      source: {
        bytes: file.size,
        width: bitmap.width,
        height: bitmap.height,
        mimeType: detectedType,
      },
      notices,
      warnings,
    };
  } finally {
    bitmap.close?.();
  }
}
