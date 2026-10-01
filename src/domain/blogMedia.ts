/**
 * Blog media policy — the cover/thumbnail decision in one place.
 *
 * Verified Core service constraints (Core `108bf191` / v6.1.9):
 * - `THUMBNAIL(410, maxSize = 500 KiB, single = true)` → a cover must be one file
 *   of at most 500 KiB.
 * - `DOCUMENT(800, maxSize = null)` → the app imposes its own envelope caps.
 *
 * The same cover bytes are also embedded as base64 inside the derived
 * SubWire-compatible article (`coverImage.src`) and, when the owner chooses it,
 * inside the Quitter announcement image. Both consumers render the cover as
 * `data:image/webp;base64,<src>` (verified in SubWire `ArticleCard.tsx`; Quitter
 * sniffs the magic bytes in `Post.tsx`), so the encoder must produce real WebP
 * bytes. WebP base64 is ~1.37x the binary size, so the 320 KiB app cap keeps the
 * derived article comfortably inside both SubWire's 5 MiB discovery limit and the
 * `THUMBNAIL` service cap.
 *
 * This module contains no browser API usage.
 */

/** Cover encoding policy; the encoder falls back in bounded steps and then fails closed. */
export const BLOG_COVER_POLICY = {
  maxEdge: 1280,
  quality: 0.82,
  format: 'image/webp',
  maxBytes: 320 * 1024,
} as const;

/** Source formats the shared image pipeline can decode for a cover. */
export const BLOG_COVER_SOURCE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** The `accept` attribute for the cover file input. */
export const BLOG_COVER_ACCEPT = BLOG_COVER_SOURCE_MIME_TYPES.join(',');
