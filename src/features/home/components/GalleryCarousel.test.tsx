import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { GalleryCarousel } from './GalleryCarousel';

/** jsdom reports zero geometry; force a copy wider than the viewport. */
function withForcedOverflow(run: () => void) {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const originalOffset = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  const originalClient = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');

  Object.defineProperty(proto, 'offsetWidth', { configurable: true, get: () => 1000 });
  Object.defineProperty(proto, 'clientWidth', { configurable: true, get: () => 300 });

  try {
    run();
  } finally {
    if (originalOffset) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffset);
    }
    if (originalClient) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', originalClient);
    }
  }
}

const items = (count: number) => (
  <ul>
    {Array.from({ length: count }, (_, index) => (
      <li className="sa-gallery__item" key={index}>
        <a href={`#item-${index}`}>Item {index + 1}</a>
      </li>
    ))}
  </ul>
);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GalleryCarousel', () => {
  it('renders one accessible copy and no controls when content fits', () => {
    render(
      <GalleryCarousel label="Latest gallery media" itemCount={8}>
        {items(8)}
      </GalleryCarousel>,
    );

    const region = screen.getByRole('group', { name: 'Latest gallery media' });
    expect(region).toHaveAttribute('data-motion', 'off');
    expect(document.querySelectorAll('.sa-gallery__carousel-copy')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: /scroll gallery/i })).not.toBeInTheDocument();
  });

  it('adds an aria-hidden, inert duplicate and edge controls when overflowing', () => {
    withForcedOverflow(() => {
      render(
        <GalleryCarousel label="Latest gallery media" itemCount={8}>
          {items(8)}
        </GalleryCarousel>,
      );

      const region = screen.getByRole('group', { name: 'Latest gallery media' });
      expect(region).toHaveAttribute('data-motion', 'on');

      const copies = document.querySelectorAll('.sa-gallery__carousel-copy');
      expect(copies).toHaveLength(2);
      const clone = copies[1] as HTMLElement;
      expect(clone).toHaveAttribute('aria-hidden', 'true');
      expect(clone).toHaveAttribute('inert');
      expect(screen.getAllByRole('link')).toHaveLength(8);

      expect(screen.getByRole('button', { name: 'Scroll gallery backwards' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Scroll gallery forwards' })).toBeInTheDocument();
    });
  });

  it('boosts in the pressed direction while an edge control is held', () => {
    withForcedOverflow(() => {
      render(
        <GalleryCarousel label="Latest gallery media" itemCount={8}>
          {items(8)}
        </GalleryCarousel>,
      );

      const region = screen.getByRole('group', { name: 'Latest gallery media' });
      const next = screen.getByRole('button', { name: 'Scroll gallery forwards' });
      fireEvent.pointerDown(next);
      expect(region).toHaveAttribute('data-boost', 'next');
      fireEvent.pointerUp(next);

      const previous = screen.getByRole('button', { name: 'Scroll gallery backwards' });
      fireEvent.pointerDown(previous);
      expect(region).toHaveAttribute('data-boost', 'prev');
      fireEvent.pointerLeave(previous);
    });
  });

  it('does not animate when the strip holds too few items', () => {
    withForcedOverflow(() => {
      render(
        <GalleryCarousel label="Latest gallery media" itemCount={2} minItemsForScroll={4}>
          {items(2)}
        </GalleryCarousel>,
      );

      expect(screen.getByRole('group', { name: 'Latest gallery media' })).toHaveAttribute(
        'data-motion',
        'off',
      );
      expect(document.querySelectorAll('.sa-gallery__carousel-copy')).toHaveLength(1);
    });
  });

  it('cancels its animation frame when unmounted', () => {
    const cancel = vi.spyOn(window, 'cancelAnimationFrame');
    withForcedOverflow(() => {
      const view = render(
        <GalleryCarousel label="Latest gallery media" itemCount={8}>
          {items(8)}
        </GalleryCarousel>,
      );
      view.unmount();
    });
    expect(cancel).toHaveBeenCalled();
  });
});
