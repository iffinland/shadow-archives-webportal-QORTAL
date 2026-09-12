import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';

import { renderApp } from '../../test/utils';
import { makeEnvironment } from '../../test/environment';
import { resetAuthSession } from '../../qortal/auth';

/**
 * The core Phase 2B invariant: ordinary archive browsing must never request an
 * account. These tests mount the real providers and route table with a bridge
 * present and assert `GET_USER_ACCOUNT` is never issued.
 */

const PUBLIC_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ['/', 'Shadow Archives'],
  ['/blog', 'Blog'],
  ['/videos', 'Videos'],
  ['/gallery', 'Gallery'],
  ['/search?q=redaction', 'Search'],
  ['/category/field-notes', 'Category'],
  ['/tag/archive', 'Tag'],
];

function installBridge() {
  const mock = vi.fn<(payload: Record<string, unknown>) => Promise<unknown>>(() =>
    Promise.resolve([]),
  );
  Object.defineProperty(window, 'qortalRequest', {
    configurable: true,
    writable: true,
    value: mock,
  });
  return mock;
}

function accountRequests(bridge: ReturnType<typeof installBridge>) {
  return bridge.mock.calls.filter((call) => call[0]?.action === 'GET_USER_ACCOUNT');
}

beforeEach(() => {
  resetAuthSession();
});

afterEach(() => {
  resetAuthSession();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'qortalRequest');
});

describe('permission-free public browsing', () => {
  it('issues no bridge call at all for an unscoped hosted context', async () => {
    const bridge = installBridge();

    for (const [route, heading] of PUBLIC_ROUTES) {
      renderApp({
        route,
        environment: makeEnvironment({ bridgeAvailable: true, isHosted: true, context: 'app' }),
      });
      await screen.findByRole('heading', { level: 1, name: heading });
      cleanup();
    }

    expect(bridge).not.toHaveBeenCalled();
  }, 60_000);

  it('issues no account request in the published read-only render runtime', async () => {
    // The observed published runtime: injected identity, no reachable bridge.
    // Browsing must still work and must never open an account prompt.
    const bridge = installBridge();
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('[]') })),
    );

    renderApp({
      route: '/gallery',
      environment: makeEnvironment({
        context: 'render',
        service: 'APP',
        name: 'Shadow%20Archives',
        publisherName: 'Shadow Archives',
        base: '/render/APP/Shadow%20Archives',
      }),
    });
    await screen.findByRole('heading', { level: 1, name: 'Gallery' });

    expect(accountRequests(bridge)).toHaveLength(0);
    expect(bridge).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('never issues GET_USER_ACCOUNT while reading a scoped archive', async () => {
    const bridge = installBridge();

    renderApp({
      route: '/',
      environment: makeEnvironment({
        bridgeAvailable: true,
        isHosted: true,
        context: 'app',
        service: 'APP',
        name: 'Shadow%20Archives',
        publisherName: 'Shadow Archives',
      }),
    });
    await screen.findByRole('heading', { level: 1, name: 'Shadow Archives' });

    expect(accountRequests(bridge)).toHaveLength(0);
  });
});
