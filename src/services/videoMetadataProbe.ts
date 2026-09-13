/**
 * Bounded in-browser video probe.
 *
 * Reads only the media *metadata* (duration + intrinsic dimensions) from a
 * selected file via a detached `<video>` element and an object URL. It never
 * decodes or uploads frames, and it is loaded only with the lazy Videos-owner
 * chunk.
 *
 * The duration the entity stores is owner-visible and correctable in the modal,
 * so a browser that cannot read metadata degrades to "type it in" instead of
 * blocking the publication.
 */

export interface VideoProbeResult {
  readonly durationSeconds: number;
  readonly width: number;
  readonly height: number;
}

export class VideoProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VideoProbeError';
  }
}

/** The subset of `HTMLVideoElement` this module uses (injectable for tests). */
export interface VideoElementLike {
  src: string;
  preload: string;
  muted: boolean;
  duration: number;
  videoWidth: number;
  videoHeight: number;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
  load(): void;
  removeAttribute(name: string): void;
}

export interface VideoProbeDeps {
  createVideo(): VideoElementLike;
  createObjectUrl(file: Blob): string;
  revokeObjectUrl(url: string): void;
  setTimeout(handler: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

export const browserVideoProbeDeps: VideoProbeDeps = {
  createVideo: () => document.createElement('video') as unknown as VideoElementLike,
  createObjectUrl: (file) => URL.createObjectURL(file),
  revokeObjectUrl: (url) => URL.revokeObjectURL(url),
  setTimeout: (handler, ms) => globalThis.setTimeout(handler, ms) as unknown as number,
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
};

/** Bounded deadline: metadata for a local file is available almost immediately. */
export const VIDEO_PROBE_TIMEOUT_MS = 20_000;

/**
 * Read duration + intrinsic size from a local file.
 *
 * Rejects with `VideoProbeError` when the browser cannot produce metadata within
 * the bounded deadline, so the modal can explain the situation instead of
 * hanging.
 */
export async function probeVideoFile(
  file: File,
  deps: VideoProbeDeps = browserVideoProbeDeps,
  timeoutMs: number = VIDEO_PROBE_TIMEOUT_MS,
): Promise<VideoProbeResult> {
  const element = deps.createVideo();
  const url = deps.createObjectUrl(file);

  return new Promise<VideoProbeResult>((resolve, reject) => {
    let settled = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      deps.clearTimeout(handle);
      element.removeEventListener('loadedmetadata', onLoaded);
      element.removeEventListener('error', onError);
      element.removeAttribute('src');
      try {
        element.load();
      } catch {
        // Detaching the element is best-effort cleanup.
      }
      deps.revokeObjectUrl(url);
      outcome();
    };

    const onLoaded = () => {
      const duration = element.duration;
      finish(() => {
        if (!Number.isFinite(duration) || duration <= 0) {
          reject(new VideoProbeError('The browser could not determine the video duration.'));
          return;
        }
        resolve({
          durationSeconds: duration,
          width: element.videoWidth,
          height: element.videoHeight,
        });
      });
    };

    const onError = () => {
      finish(() =>
        reject(
          new VideoProbeError(
            'The browser could not read this video file. It may use an unsupported codec or container.',
          ),
        ),
      );
    };

    const handle = deps.setTimeout(() => {
      finish(() =>
        reject(
          new VideoProbeError('Reading the video metadata timed out. Enter the duration manually.'),
        ),
      );
    }, timeoutMs);

    element.addEventListener('loadedmetadata', onLoaded);
    element.addEventListener('error', onError);
    element.muted = true;
    element.preload = 'metadata';
    element.src = url;
    try {
      element.load();
    } catch {
      // Some elements auto-load on src assignment; a manual load is optional.
    }
  });
}
