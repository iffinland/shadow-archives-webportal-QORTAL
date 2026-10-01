/**
 * Video media policy — one central place for the video/thumbnail size, container
 * and format decisions, so they can be tuned without hunting through components.
 *
 * Verified Core service constraints (`org.qortal.arbitrary.misc.Service`,
 * Core `108bf191` / v6.1.9):
 * - `VIDEO(500, …, single = true)` → a `VIDEO` resource is a **single file** with
 *   no Core byte cap.
 * - `THUMBNAIL(410, maxSize = 500 KiB, single = true)` → a poster must be one
 *   file of at most 500 KiB.
 * - `DOCUMENT(800, maxSize = null)` → the app imposes its own envelope caps.
 *
 * Host-side ceiling (verified 2026-09-13, Hub `12a573b2` `src/constants/constants.ts`):
 * `MAX_SIZE_PUBLISH = 2000 * 1024 * 1024` (2 GB) for a `file`/`blob` publish,
 * and `MAX_SIZE_PUBLIC_NODE = 500 MB` when the host runs as a public gateway.
 * `q-tube` applies the same 2 GiB client-side ceiling. Shadow Archives mirrors
 * that ceiling and fails closed above it instead of letting the host reject the
 * submission after approval.
 *
 * This module contains no browser API usage.
 */

/** Container formats browsers can play and the ecosystem publishes. */
export const VIDEO_SOURCE_MIME_TYPES = [
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
] as const;

export type VideoSourceMime = (typeof VIDEO_SOURCE_MIME_TYPES)[number];

/** Containers the ecosystem rejects (browser playback is not dependable). */
export const VIDEO_BLOCKED_EXTENSIONS = ['mkv', 'avi', 'wmv', 'flv', 'ts', 'm4v'] as const;

export const VIDEO_MEDIA_POLICY = {
  /** Mirrors the verified host ceiling (`MAX_SIZE_PUBLISH` = 2 GB). */
  maxSourceBytes: 2000 * 1024 * 1024,
  /** A zero-byte or absurdly tiny file is never a real video. */
  minSourceBytes: 1024,
  /**
   * Poster policy.
   *
   * The `THUMBNAIL` service caps a poster at 500 KiB, and the same bytes are
   * also embedded (base64) twice inside the Q-Tube interoperability metadata
   * artifact — once as `videoImage` and once as the single `extracts` frame that
   * keeps Q-Tube's hover preview from falling back to its "deleted video"
   * placeholder. The 256 KiB app cap therefore keeps both the `THUMBNAIL`
   * resource and the metadata artifact comfortably inside their limits, and the
   * encoder falls back in bounded steps (and then fails closed) if a complex
   * frame does not fit.
   */
  thumbnail: { maxEdge: 720, quality: 0.82, format: 'image/webp', maxBytes: 256 * 1024 },
  /** Verified Core caps (bytes) used for the client-side fail-closed check. */
  serviceLimits: { thumbnail: 500 * 1024 },
} as const;

export function isSupportedVideoMime(value: unknown): value is VideoSourceMime {
  return (
    typeof value === 'string' && (VIDEO_SOURCE_MIME_TYPES as readonly string[]).includes(value)
  );
}

/** Lower-cased extension of a file name, or '' when there is none. */
export function fileExtension(fileName: string): string {
  const cleaned = fileName.trim().toLowerCase();
  const dot = cleaned.lastIndexOf('.');
  if (dot < 0 || dot === cleaned.length - 1) return '';
  return cleaned.slice(dot + 1);
}

export function isBlockedVideoExtension(fileName: string): boolean {
  const extension = fileExtension(fileName);
  return (
    extension.length > 0 && (VIDEO_BLOCKED_EXTENSIONS as readonly string[]).includes(extension)
  );
}

export interface VideoSourceCheck {
  readonly ok: boolean;
  readonly message: string | null;
}

/**
 * Bounded, non-throwing source check used by the owner modal before any bytes are
 * read. It never claims a codec is playable — only that the container/declared
 * type/size are within policy.
 */
export function checkVideoSourceSize(bytes: number, fileName: string): VideoSourceCheck {
  if (!Number.isFinite(bytes) || bytes < VIDEO_MEDIA_POLICY.minSourceBytes) {
    return { ok: false, message: 'The selected file is empty or unreadably small.' };
  }
  if (isBlockedVideoExtension(fileName)) {
    return {
      ok: false,
      message: `The .${fileExtension(fileName)} container is not supported. Use MP4 or WebM.`,
    };
  }
  if (bytes > VIDEO_MEDIA_POLICY.maxSourceBytes) {
    const limitGb = (VIDEO_MEDIA_POLICY.maxSourceBytes / 1024 ** 3).toFixed(0);
    const actualGb = (bytes / 1024 ** 3).toFixed(2);
    return {
      ok: false,
      message: `The video is ${actualGb} GB; the publishing limit is ${limitGb} GB.`,
    };
  }
  return { ok: true, message: null };
}

/** True when a video's declared type is acceptable ('' is tolerated and sniffed). */
export function checkVideoSourceType(mimeType: string): VideoSourceCheck {
  if (mimeType.length === 0) return { ok: true, message: null };
  if (isSupportedVideoMime(mimeType)) return { ok: true, message: null };
  return {
    ok: false,
    message: `Unsupported video type ${mimeType}. Supported: MP4, WebM, Ogg, QuickTime.`,
  };
}

/** Format seconds as `m:ss` / `h:mm:ss` for the modal and detail page. */
export function formatDurationLabel(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const pad = (value: number) => value.toString().padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`;
}
