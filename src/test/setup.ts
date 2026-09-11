import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

/*
 * Lazy route chunks import heavier read-only dependencies (for example the
 * DOMPurify-sanitized rich-text renderer on the blog detail route). Under
 * parallel test load a chunk can take longer than Testing Library's 1s default
 * to resolve, so raise the shared async timeout instead of sprinkling explicit
 * timeouts through individual assertions.
 */
configure({ asyncUtilTimeout: 8000 });

/**
 * jsdom does not implement `matchMedia` or `ResizeObserver`. The defaults here
 * mean "no reduced motion" and "never overflow", so motion code paths stay
 * inert unless a test explicitly overrides them.
 */
function installMatchMedia() {
  const matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }));

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: matchMedia,
  });
}

function installResizeObserver() {
  class ResizeObserverMock {
    observe() {}
    unobserve() {}
    disconnect() {}
  }

  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: ResizeObserverMock,
  });
}

beforeEach(() => {
  installMatchMedia();
  installResizeObserver();
});

afterEach(() => {
  cleanup();
});
