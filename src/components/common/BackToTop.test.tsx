import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { BackToTop } from './BackToTop';

function setScrollY(value: number) {
  Object.defineProperty(window, 'scrollY', { configurable: true, writable: true, value });
}

const originalScrollTo = window.scrollTo;

afterEach(() => {
  setScrollY(0);
  Object.defineProperty(window, 'scrollTo', {
    configurable: true,
    writable: true,
    value: originalScrollTo,
  });
});

describe('BackToTop', () => {
  it('is hidden and out of the tab order near the page top', () => {
    setScrollY(0);
    render(<BackToTop />);

    const button = screen.getByRole('button', { name: 'Back to top' });
    expect(button).toHaveAttribute('data-visible', 'false');
    expect(button).toHaveAttribute('tabindex', '-1');
  });

  it('appears after a meaningful downward scroll', () => {
    setScrollY(0);
    render(<BackToTop />);

    setScrollY(1200);
    fireEvent.scroll(window);

    const button = screen.getByRole('button', { name: 'Back to top' });
    expect(button).toHaveAttribute('data-visible', 'true');
    expect(button).toHaveAttribute('tabindex', '0');
  });

  it('returns smoothly to the top when activated', () => {
    setScrollY(1200);
    const scrollTo = vi.fn();
    Object.defineProperty(window, 'scrollTo', {
      configurable: true,
      writable: true,
      value: scrollTo,
    });

    render(<BackToTop />);
    fireEvent.scroll(window);
    fireEvent.click(screen.getByRole('button', { name: 'Back to top' }));

    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
  });
});
