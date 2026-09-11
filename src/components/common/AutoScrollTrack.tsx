import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import { usePrefersReducedMotion } from '../../utils/motion';
import { isTrackOverflowing } from '../../utils/overflow';

const INTERACTION_COOLDOWN_MS = 3000;

export type {
  ScrollOrientation as AutoScrollOrientation,
  TrackMetrics,
} from '../../utils/overflow';

interface AutoScrollTrackProps {
  readonly orientation: 'vertical' | 'horizontal';
  /** Accessible label for the scrollable region. */
  readonly label: string;
  /** Number of real (non-duplicated) items; gates motion so 1–2 items never move. */
  readonly itemCount: number;
  readonly minItemsForScroll?: number;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * Reusable auto-scroll mechanism for Top Posts / Top Videos / gallery strip.
 *
 * Contract (Phase 1A §5):
 * - the original list is always real DOM with real links;
 * - the duplicate copy is `aria-hidden` and `inert` (removed from tab order);
 * - hover, focus-within, pointer/wheel interaction, document-hidden and
 *   `prefers-reduced-motion` all stop the motion;
 * - when motion is off the region is natively scrollable, so no content is
 *   reachable only through animation.
 */
export function AutoScrollTrack({
  orientation,
  label,
  itemCount,
  minItemsForScroll = 5,
  children,
  className,
}: AutoScrollTrackProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [overflowing, setOverflowing] = useState(false);
  const [paused, setPaused] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const track = trackRef.current;
    if (!viewport || !track) return;

    const measure = () => {
      const overflow = isTrackOverflowing(orientation, {
        clientHeight: viewport.clientHeight,
        clientWidth: viewport.clientWidth,
        scrollHeight: track.scrollHeight,
        scrollWidth: track.scrollWidth,
      });
      setOverflowing((previous) => (previous === overflow ? previous : overflow));
    };

    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(track);
    return () => observer.disconnect();
  }, [orientation, itemCount]);

  const motionEnabled = !reducedMotion && overflowing && itemCount >= minItemsForScroll;

  const pauseForCooldown = useCallback(() => {
    setPaused(true);
    if (cooldownRef.current !== undefined) clearTimeout(cooldownRef.current);
    cooldownRef.current = setTimeout(() => {
      cooldownRef.current = undefined;
      setPaused(false);
    }, INTERACTION_COOLDOWN_MS);
  }, []);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !motionEnabled) return;

    const onInteraction = () => pauseForCooldown();
    viewport.addEventListener('pointerdown', onInteraction);
    viewport.addEventListener('wheel', onInteraction, { passive: true });
    viewport.addEventListener('touchstart', onInteraction, { passive: true });
    return () => {
      viewport.removeEventListener('pointerdown', onInteraction);
      viewport.removeEventListener('wheel', onInteraction);
      viewport.removeEventListener('touchstart', onInteraction);
    };
  }, [motionEnabled, pauseForCooldown]);

  useEffect(() => {
    if (!motionEnabled) return;
    const onVisibilityChange = () => setPaused(document.hidden);
    onVisibilityChange();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [motionEnabled]);

  useEffect(
    () => () => {
      if (cooldownRef.current !== undefined) clearTimeout(cooldownRef.current);
    },
    [],
  );

  return (
    <div
      ref={viewportRef}
      className={['sa-autoscroll', className].filter(Boolean).join(' ')}
      data-orientation={orientation}
      data-motion={motionEnabled ? 'on' : 'off'}
      data-paused={paused ? 'true' : 'false'}
      aria-label={label}
      role="group"
    >
      <div ref={trackRef} className="sa-autoscroll__track">
        <div className="sa-autoscroll__copy">{children}</div>
        {motionEnabled ? (
          <div className="sa-autoscroll__copy sa-autoscroll__copy--clone" aria-hidden="true" inert>
            {children}
          </div>
        ) : null}
      </div>
    </div>
  );
}
