import { useState, type ReactNode } from 'react';

interface MediaFrameProps {
  readonly src?: string;
  readonly alt: string;
  /** Intrinsic dimensions reserve space and prevent layout shift. */
  readonly width: number;
  readonly height: number;
  readonly className?: string;
  /** Lazy for anything below the fold; the banner opts into eager loading. */
  readonly loading?: 'lazy' | 'eager';
  readonly fetchPriority?: 'high' | 'low' | 'auto';
  readonly fallback?: ReactNode;
}

/**
 * Aspect-ratio-reserving image box. Never requests video bytes; gallery and
 * card thumbnails use this with thumbnail sources only.
 */
export function MediaFrame({
  src,
  alt,
  width,
  height,
  className,
  loading = 'lazy',
  fetchPriority = 'auto',
  fallback = null,
}: MediaFrameProps) {
  const [failed, setFailed] = useState(false);

  return (
    <span
      className={['sa-media-frame', className].filter(Boolean).join(' ')}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      {src && !failed ? (
        <img
          className="sa-media-frame__image"
          src={src}
          alt={alt}
          width={width}
          height={height}
          loading={loading}
          decoding="async"
          fetchPriority={fetchPriority}
          onError={() => setFailed(true)}
        />
      ) : (
        fallback
      )}
    </span>
  );
}
