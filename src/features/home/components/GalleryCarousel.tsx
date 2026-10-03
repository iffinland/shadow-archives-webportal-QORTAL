import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { IconTriangleLeft, IconTriangleRight } from '../../../components/common';
import { usePrefersReducedMotion } from '../../../utils/motion';

/** Slow, continuous auto-scroll speed (px per second). */
const BASE_SPEED_PX_PER_SEC = 22;
/** Faster speed while a previous/next control is pressed or tapped. */
const BOOST_SPEED_PX_PER_SEC = 260;
/** Minimum movement window so a quick tap still nudges the strip. */
const TAP_BOOST_MS = 320;
/** Easing rate used when a focused item is brought into view. */
const FOCUS_EASE_PER_SEC = 9;
const FOCUS_MARGIN_PX = 12;

type BoostDirection = -1 | 0 | 1;

interface GalleryCarouselProps {
  /** Accessible label for the scrollable region. */
  readonly label: string;
  /** Number of real (non-duplicated) items; gates motion for very short strips. */
  readonly itemCount: number;
  readonly minItemsForScroll?: number;
  readonly children: ReactNode;
  readonly className?: string;
}

/**
 * Gallery-specific horizontal carousel.
 *
 * Contract:
 * - the original list is real DOM with real links; the duplicate copy is
 *   `aria-hidden` and `inert`;
 * - the strip never shows a native scrollbar (translate-based, `overflow: hidden`);
 * - motion is a slow continuous loop; holding/tapping the triangular edge
 *   controls moves faster in that direction than the default auto-scroll;
 * - hover, focus-within, document-hidden and `prefers-reduced-motion` stop the
 *   automatic motion (a user-pressed control still moves the strip);
 * - tabbing to an off-screen item eases it back into view.
 */
export function GalleryCarousel({
  label,
  itemCount,
  minItemsForScroll = 4,
  children,
  className,
}: GalleryCarouselProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const copyRef = useRef<HTMLDivElement>(null);

  const positionRef = useRef(0);
  const loopWidthRef = useRef(0);
  const pausedRef = useRef(false);
  const boostDirectionRef = useRef<BoostDirection>(0);
  const boostUntilRef = useRef(0);
  const focusTargetRef = useRef<number | null>(null);
  const rafRef = useRef<number | undefined>(undefined);
  const lastFrameRef = useRef<number | null>(null);
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const reducedMotion = usePrefersReducedMotion();
  const reducedMotionRef = useRef(reducedMotion);
  const [overflowing, setOverflowing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [boostDirection, setBoostDirection] = useState<BoostDirection>(0);

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
  }, [reducedMotion]);

  const enabled = overflowing && itemCount >= minItemsForScroll;

  // Measure one copy of the loop. jsdom reports zero geometry, so motion stays
  // off in tests unless a test explicitly forces overflow.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const copy = copyRef.current;
    if (!viewport || !copy) return;

    const measure = () => {
      const loop = copy.offsetWidth;
      loopWidthRef.current = loop;
      const hasOverflow = loop > viewport.clientWidth + 1;
      setOverflowing((previous) => (previous === hasOverflow ? previous : hasOverflow));
    };

    measure();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(copy);
    return () => observer.disconnect();
  }, [itemCount, enabled]);

  // Single animation loop; never accumulates because it is cancelled on unmount
  // and whenever the carousel stops being active.
  useEffect(() => {
    if (!enabled) {
      positionRef.current = 0;
      focusTargetRef.current = null;
      if (trackRef.current) trackRef.current.style.transform = '';
      return;
    }

    const step = (now: number) => {
      rafRef.current = requestAnimationFrame(step);

      const last = lastFrameRef.current;
      lastFrameRef.current = now;
      if (last === null) return;

      const delta = Math.min(0.05, Math.max(0, (now - last) / 1000));
      const loop = loopWidthRef.current;
      if (loop <= 0) return;

      let position = positionRef.current;
      const boost = boostDirectionRef.current;

      if (boost !== 0 && now < boostUntilRef.current) {
        position += boost * BOOST_SPEED_PX_PER_SEC * delta;
        focusTargetRef.current = null;
      } else {
        if (boost !== 0) {
          boostDirectionRef.current = 0;
          setBoostDirection(0);
        }
        const focusTarget = focusTargetRef.current;
        if (focusTarget !== null) {
          const remaining = focusTarget - position;
          if (Math.abs(remaining) < 1) {
            position = focusTarget;
            focusTargetRef.current = null;
          } else {
            position += remaining * Math.min(1, delta * FOCUS_EASE_PER_SEC);
          }
        } else if (!pausedRef.current && !reducedMotionRef.current) {
          position += BASE_SPEED_PX_PER_SEC * delta;
        }
      }

      position = ((position % loop) + loop) % loop;
      positionRef.current = position;
      if (trackRef.current) {
        trackRef.current.style.transform = `translate3d(${-position}px, 0, 0)`;
      }
    };

    lastFrameRef.current = null;
    rafRef.current = requestAnimationFrame(step);

    return () => {
      if (rafRef.current !== undefined) cancelAnimationFrame(rafRef.current);
      rafRef.current = undefined;
      lastFrameRef.current = null;
    };
  }, [enabled]);

  const applyPaused = useCallback((next: boolean) => {
    pausedRef.current = next;
    setPaused((previous) => (previous === next ? previous : next));
  }, []);

  // Hover / keyboard focus / hidden tab all stop the automatic motion; a focused
  // off-screen item is eased back into the viewport for keyboard users.
  useEffect(() => {
    if (!enabled) {
      pausedRef.current = false;
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) return;

    const onPointerEnter = () => applyPaused(true);
    const onPointerLeave = () => applyPaused(false);
    const onFocusIn = (event: FocusEvent) => {
      applyPaused(true);
      const target = event.target as HTMLElement | null;
      const item = target?.closest('.sa-gallery__item');
      const loop = loopWidthRef.current;
      if (!(item instanceof HTMLElement) || loop <= 0) return;

      const itemLeft = item.offsetLeft;
      const itemRight = itemLeft + item.offsetWidth;
      const viewportWidth = viewport.clientWidth;
      const position = positionRef.current;
      if (
        itemLeft < position + FOCUS_MARGIN_PX ||
        itemRight > position + viewportWidth - FOCUS_MARGIN_PX
      ) {
        focusTargetRef.current = (((itemLeft - FOCUS_MARGIN_PX) % loop) + loop) % loop;
      }
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!viewport.contains(event.relatedTarget as Node | null)) applyPaused(false);
    };

    viewport.addEventListener('pointerenter', onPointerEnter);
    viewport.addEventListener('pointerleave', onPointerLeave);
    viewport.addEventListener('focusin', onFocusIn);
    viewport.addEventListener('focusout', onFocusOut);
    return () => {
      viewport.removeEventListener('pointerenter', onPointerEnter);
      viewport.removeEventListener('pointerleave', onPointerLeave);
      viewport.removeEventListener('focusin', onFocusIn);
      viewport.removeEventListener('focusout', onFocusOut);
    };
  }, [enabled, applyPaused]);

  useEffect(() => {
    if (!enabled) return;
    const onVisibilityChange = () => applyPaused(document.hidden);
    onVisibilityChange();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [enabled, applyPaused]);

  const endBoost = useCallback(() => {
    if (boostDirectionRef.current === 0) return;
    boostUntilRef.current = performance.now() + TAP_BOOST_MS;
    if (releaseTimerRef.current !== undefined) clearTimeout(releaseTimerRef.current);
    releaseTimerRef.current = setTimeout(() => {
      releaseTimerRef.current = undefined;
      boostDirectionRef.current = 0;
      boostUntilRef.current = 0;
      setBoostDirection(0);
    }, TAP_BOOST_MS);
  }, []);

  const startBoost = useCallback((direction: -1 | 1) => {
    if (releaseTimerRef.current !== undefined) {
      clearTimeout(releaseTimerRef.current);
      releaseTimerRef.current = undefined;
    }
    boostDirectionRef.current = direction;
    boostUntilRef.current = Number.POSITIVE_INFINITY;
    setBoostDirection(direction);
  }, []);

  useEffect(
    () => () => {
      if (releaseTimerRef.current !== undefined) clearTimeout(releaseTimerRef.current);
    },
    [],
  );

  const handleKeyDown = (direction: -1 | 1) => (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === ' ' || event.key === 'Enter') startBoost(direction);
  };
  const handleKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === ' ' || event.key === 'Enter') endBoost();
  };

  return (
    <div
      ref={viewportRef}
      className={['sa-gallery__carousel', className].filter(Boolean).join(' ')}
      data-motion={enabled && !reducedMotion ? 'on' : 'off'}
      data-boost={boostDirection === 1 ? 'next' : boostDirection === -1 ? 'prev' : 'none'}
      data-paused={enabled && paused ? 'true' : 'false'}
      role="group"
      aria-label={label}
    >
      <div ref={trackRef} className="sa-gallery__carousel-track">
        <div ref={copyRef} className="sa-gallery__carousel-copy">
          {children}
        </div>
        {enabled ? (
          <div
            className="sa-gallery__carousel-copy sa-gallery__carousel-copy--clone"
            aria-hidden="true"
            inert
          >
            {children}
          </div>
        ) : null}
      </div>

      {enabled ? (
        <>
          <button
            type="button"
            className="sa-gallery__nav sa-gallery__nav--prev"
            aria-label="Scroll gallery backwards"
            title="Scroll gallery backwards"
            onPointerDown={() => startBoost(-1)}
            onPointerUp={endBoost}
            onPointerLeave={endBoost}
            onPointerCancel={endBoost}
            onKeyDown={handleKeyDown(-1)}
            onKeyUp={handleKeyUp}
            onBlur={endBoost}
          >
            <IconTriangleLeft width={26} height={26} />
          </button>
          <button
            type="button"
            className="sa-gallery__nav sa-gallery__nav--next"
            aria-label="Scroll gallery forwards"
            title="Scroll gallery forwards"
            onPointerDown={() => startBoost(1)}
            onPointerUp={endBoost}
            onPointerLeave={endBoost}
            onPointerCancel={endBoost}
            onKeyDown={handleKeyDown(1)}
            onKeyUp={handleKeyUp}
            onBlur={endBoost}
          >
            <IconTriangleRight width={26} height={26} />
          </button>
        </>
      ) : null}
    </div>
  );
}
