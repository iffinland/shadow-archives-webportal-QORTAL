/** Scroll-axis metrics used to decide whether auto-scroll may engage. */
export interface TrackMetrics {
  readonly clientHeight: number;
  readonly clientWidth: number;
  readonly scrollHeight: number;
  readonly scrollWidth: number;
}

export type ScrollOrientation = 'vertical' | 'horizontal';

/**
 * Pure overflow test. Extracted from the component so the motion gate is
 * unit-testable without a layout engine (jsdom reports zero geometry).
 */
export function isTrackOverflowing(orientation: ScrollOrientation, metrics: TrackMetrics): boolean {
  return orientation === 'vertical'
    ? metrics.scrollHeight > metrics.clientHeight + 1
    : metrics.scrollWidth > metrics.clientWidth + 1;
}
