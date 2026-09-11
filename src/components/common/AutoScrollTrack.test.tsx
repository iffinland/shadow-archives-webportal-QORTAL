import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { isTrackOverflowing } from '../../utils/overflow';
import { AutoScrollTrack } from './AutoScrollTrack';

function setReducedMotion(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

function withForcedOverflow(run: () => void) {
  const elementProto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const originalScrollHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'scrollHeight',
  );
  const originalClientHeight = Object.getOwnPropertyDescriptor(
    HTMLElement.prototype,
    'clientHeight',
  );

  Object.defineProperty(elementProto, 'scrollHeight', {
    configurable: true,
    get: () => 1000,
  });
  Object.defineProperty(elementProto, 'clientHeight', {
    configurable: true,
    get: () => 100,
  });

  try {
    run();
  } finally {
    if (originalScrollHeight) {
      Object.defineProperty(HTMLElement.prototype, 'scrollHeight', originalScrollHeight);
    }
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', originalClientHeight);
    }
  }
}

const items = (count: number) => (
  <ol>
    {Array.from({ length: count }, (_, index) => (
      <li key={index}>
        <a href={`#item-${index}`}>Item {index + 1}</a>
      </li>
    ))}
  </ol>
);

describe('isTrackOverflowing', () => {
  it('measures the axis that matches the orientation', () => {
    const metrics = { clientHeight: 100, clientWidth: 300, scrollHeight: 400, scrollWidth: 300 };
    expect(isTrackOverflowing('vertical', metrics)).toBe(true);
    expect(isTrackOverflowing('horizontal', metrics)).toBe(false);
  });

  it('treats a 1px rounding difference as not overflowing', () => {
    expect(
      isTrackOverflowing('vertical', {
        clientHeight: 100,
        clientWidth: 100,
        scrollHeight: 101,
        scrollWidth: 100,
      }),
    ).toBe(false);
  });
});

describe('AutoScrollTrack', () => {
  it('renders a single accessible copy when content does not overflow', () => {
    render(
      <AutoScrollTrack orientation="vertical" label="Top posts" itemCount={8} minItemsForScroll={5}>
        {items(8)}
      </AutoScrollTrack>,
    );

    expect(screen.getByLabelText('Top posts')).toHaveAttribute('data-motion', 'off');
    expect(document.querySelectorAll('.sa-autoscroll__copy')).toHaveLength(1);
    expect(screen.getAllByRole('link')).toHaveLength(8);
  });

  it('does not animate when there is insufficient content, even if it overflows', () => {
    withForcedOverflow(() => {
      render(
        <AutoScrollTrack
          orientation="vertical"
          label="Top posts"
          itemCount={2}
          minItemsForScroll={5}
        >
          {items(2)}
        </AutoScrollTrack>,
      );
      expect(screen.getByLabelText('Top posts')).toHaveAttribute('data-motion', 'off');
      expect(document.querySelectorAll('.sa-autoscroll__copy')).toHaveLength(1);
    });
  });

  it('disables motion entirely under prefers-reduced-motion', () => {
    setReducedMotion(true);
    withForcedOverflow(() => {
      render(
        <AutoScrollTrack orientation="vertical" label="Top posts" itemCount={20}>
          {items(20)}
        </AutoScrollTrack>,
      );
      expect(screen.getByLabelText('Top posts')).toHaveAttribute('data-motion', 'off');
      expect(document.querySelectorAll('.sa-autoscroll__copy')).toHaveLength(1);
    });
  });

  it('adds one aria-hidden, non-focusable duplicate only when motion is enabled', () => {
    withForcedOverflow(() => {
      render(
        <AutoScrollTrack orientation="vertical" label="Top posts" itemCount={20}>
          {items(20)}
        </AutoScrollTrack>,
      );

      const viewport = screen.getByLabelText('Top posts');
      expect(viewport).toHaveAttribute('data-motion', 'on');
      expect(viewport).toHaveAttribute('data-paused', 'false');

      const copies = document.querySelectorAll('.sa-autoscroll__copy');
      expect(copies).toHaveLength(2);

      const clone = copies[1] as HTMLElement;
      expect(clone).toHaveAttribute('aria-hidden', 'true');
      expect(clone).toHaveAttribute('inert');
      // The duplicate must not add anything to the accessibility tree.
      expect(screen.getAllByRole('link')).toHaveLength(20);

      // Pointer interaction pauses the motion for a cooldown.
      fireEvent.pointerDown(viewport);
      expect(viewport).toHaveAttribute('data-paused', 'true');
    });
  });
});
