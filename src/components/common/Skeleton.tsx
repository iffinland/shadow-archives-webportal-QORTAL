import type { CSSProperties, ReactNode } from 'react';

interface SkeletonProps {
  /** Width in CSS units; numbers become px. */
  readonly width?: number | string;
  readonly height?: number | string;
  readonly radius?: string;
  readonly className?: string;
}

/**
 * Purely decorative placeholder. Skeleton geometry mirrors the final box so
 * the swap to content does not shift layout (Phase 1A §8).
 */
export function Skeleton({ width, height, radius, className }: SkeletonProps) {
  const style: CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    borderRadius: radius,
  };
  return <span className={['sa-skeleton', className].filter(Boolean).join(' ')} style={style} />;
}

interface SkeletonGroupProps {
  /** Accessible label announced while the region is busy. */
  readonly label: string;
  readonly children: ReactNode;
  readonly className?: string;
}

export function SkeletonGroup({ label, children, className }: SkeletonGroupProps) {
  return (
    <div
      className={['sa-skeleton-group', className].filter(Boolean).join(' ')}
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sa-visually-hidden">{label}</span>
      {children}
    </div>
  );
}

/** Reserved geometry for a single content card (media box + 2 text lines + action row). */
export function ContentCardSkeleton() {
  return (
    <div className="sa-card sa-card--skeleton" aria-hidden="true">
      <Skeleton className="sa-card__media" />
      <div className="sa-card__body">
        <Skeleton height={16} width="85%" />
        <Skeleton height={12} width="60%" />
      </div>
      <div className="sa-card__actions">
        <Skeleton height={24} width={64} radius="999px" />
        <Skeleton height={24} width={64} radius="999px" />
      </div>
    </div>
  );
}
