/**
 * Gallery media policy — one central place for the size/format/dimension
 * decisions so they can be tuned without hunting through components.
 *
 * Limits are derived from the verified Core service constraints
 * (`Service.java`, Core `108bf191` / v6.1.9):
 * - `IMAGE(400, …, maxSize = 10 MB, …)` → a gallery image must be <= 10 MiB.
 * - `THUMBNAIL(410, …, maxSize = 500 KiB, single = true)` → a thumbnail must be
 *   a single file of <= 500 KiB.
 * - `DOCUMENT(800, …, maxSize = null)` → the app imposes its own envelope cap
 *   (`LIMITS.entityBytes` / `LIMITS.catalogBytes`).
 *
 * This module intentionally contains no browser API usage; the in-browser
 * pipeline lives in `services/imageProcessing.ts` and is loaded lazily.
 */

/** Raster still formats supported by this phase. Video/GIF are out of scope. */
export const GALLERY_IMAGE_SOURCE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

export type GalleryImageSourceMime = (typeof GALLERY_IMAGE_SOURCE_MIME_TYPES)[number];

export interface GalleryMediaEncodingPolicy {
  /** Longest edge in CSS pixels; smaller images are never upscaled. */
  readonly maxEdge: number;
  /** Lossy encoder quality (0..1) for formats that accept one. */
  readonly quality: number;
  /** Preferred output format; the browser may fall back, which is verified after encoding. */
  readonly format: string;
}

export const GALLERY_MEDIA_POLICY = {
  /** Reject absurdly large source files before decoding them into memory. */
  maxSourceBytes: 25 * 1024 * 1024,
  /** Reject images whose decoded pixel count could exhaust the tab. */
  maxSourcePixels: 40_000_000,
  /** Reject single edges above this even if the pixel count is technically fine. */
  maxSourceEdge: 12_000,
  /**
   * Full-size web copy. 2400 px on the longest edge keeps a photo useful for
   * on-screen viewing and moderate zoom while staying far below the 10 MiB
   * `IMAGE` cap; WebP quality 0.85 is visually close to the source in the
   * 1500–2400 px range at roughly a third of the JPEG size. The owner sees the
   * resulting dimensions/size in the modal, so the conversion is explicit.
   */
  full: { maxEdge: 2400, quality: 0.85, format: 'image/webp' } satisfies GalleryMediaEncodingPolicy,
  /** Listing thumbnail: bounded so the `THUMBNAIL` 500 KiB cap is never approached. */
  thumbnail: {
    maxEdge: 480,
    quality: 0.8,
    format: 'image/webp',
  } satisfies GalleryMediaEncodingPolicy,
  /** Verified Core service caps (bytes) used for the client-side fail-closed check. */
  serviceLimits: {
    image: 10 * 1024 * 1024,
    thumbnail: 500 * 1024,
  },
} as const;

export function isSupportedGalleryImageMime(value: unknown): value is GalleryImageSourceMime {
  return (
    typeof value === 'string' &&
    (GALLERY_IMAGE_SOURCE_MIME_TYPES as readonly string[]).includes(value)
  );
}

export interface ScaledDimensions {
  readonly width: number;
  readonly height: number;
  /** `false` when the source already fits and must not be upscaled. */
  readonly scaled: boolean;
}

/**
 * Scale to fit `maxEdge` on the longest side, preserving aspect ratio.
 * Never upscales: an already-small image keeps its original dimensions.
 */
export function planScale(width: number, height: number, maxEdge: number): ScaledDimensions {
  const safeWidth = Math.max(1, Math.floor(width));
  const safeHeight = Math.max(1, Math.floor(height));
  const longest = Math.max(safeWidth, safeHeight);
  const edge = Math.max(1, Math.floor(maxEdge));
  if (longest <= edge) return { width: safeWidth, height: safeHeight, scaled: false };
  const ratio = edge / longest;
  return {
    width: Math.max(1, Math.round(safeWidth * ratio)),
    height: Math.max(1, Math.round(safeHeight * ratio)),
    scaled: true,
  };
}

/** Human-readable byte size for the modal's processing summary. */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}
