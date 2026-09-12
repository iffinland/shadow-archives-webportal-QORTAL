import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { BridgeProvider } from './BridgeProvider';
import { ContentProvider, useContent } from './ContentProvider';
import { resetContentCache } from '../../services';
import { makeEnvironment } from '../../test/environment';
import { makeArchiveSnapshot, makeListingFixture } from '../../test/fixtures/content';
import type { ArchiveSnapshot, LoadArchiveOptions, PublisherScope } from '../../services';

/** The exact `_qdn*` values the owner's published runtime reported, no bridge. */
const PUBLISHED_RENDER_NO_BRIDGE = makeEnvironment({
  context: 'render',
  service: 'APP',
  name: 'Shadow%20Archives',
  publisherName: 'Shadow Archives',
  base: '/render/APP/Shadow%20Archives',
  baseWithPath: '/render/APP/Shadow%20Archives',
});

const HOSTED = makeEnvironment({
  bridgeAvailable: true,
  isHosted: true,
  context: 'app',
  service: 'APP',
  name: 'Shadow%20Archives',
  publisherName: 'Shadow Archives',
  base: '/render/APP/Shadow%20Archives',
});

function Probe() {
  const { snapshot, scope } = useContent();
  return (
    <div>
      <span data-testid="status">{snapshot.status}</span>
      <span data-testid="scoped">{scope.scoped ? 'yes' : 'no'}</span>
      <span data-testid="message">{snapshot.message ?? ''}</span>
    </div>
  );
}

type Loader = (scope: PublisherScope, options?: LoadArchiveOptions) => Promise<ArchiveSnapshot>;

function renderProvider(loader?: Loader) {
  return render(
    <BridgeProvider environment={HOSTED}>
      <ContentProvider loader={loader}>
        <Probe />
      </ContentProvider>
    </BridgeProvider>,
  );
}

afterEach(() => {
  resetContentCache();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'qortalRequest');
});

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

describe('ContentProvider', () => {
  it('exposes the loader snapshot and starts in the loading state', async () => {
    const loader = vi.fn().mockResolvedValue(
      makeArchiveSnapshot({
        listings: [makeListingFixture()],
      }),
    );
    renderProvider(loader);

    expect(screen.getByTestId('status')).toHaveTextContent('loading');
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('ready'));
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('is honestly unavailable without a scoped publisher and never calls the loader', async () => {
    const loader = vi.fn().mockResolvedValue(makeArchiveSnapshot());
    render(
      <BridgeProvider environment={makeEnvironment()}>
        <ContentProvider loader={loader}>
          <Probe />
        </ContentProvider>
      </BridgeProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unavailable'));
    expect(screen.getByTestId('scoped')).toHaveTextContent('no');
    expect(loader).not.toHaveBeenCalled();
    expect(screen.getByTestId('message')).toHaveTextContent('not running inside a Qortal runtime');
  });

  it('scopes a published render context and reads it over same-origin REST without a bridge', async () => {
    // The verified shim read routes are same-origin, so the node that served the
    // document can answer them even when the host bridge is unreachable.
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse([])));
    vi.stubGlobal('fetch', fetchMock);

    render(
      <BridgeProvider environment={PUBLISHED_RENDER_NO_BRIDGE}>
        <ContentProvider>
          <Probe />
        </ContentProvider>
      </BridgeProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).not.toHaveTextContent('loading'));

    expect(screen.getByTestId('scoped')).toHaveTextContent('yes');
    // Discovery completed (bounded live search found nothing) — never the old
    // "no publisher identity" unavailable state.
    expect(screen.getByTestId('status')).not.toHaveTextContent('unavailable');
    expect(screen.getByTestId('message')).not.toHaveTextContent(
      'No production Qortal publisher identity',
    );
    expect(fetchMock).toHaveBeenCalled();
    const urls = fetchMock.mock.calls.map((call) => String((call as unknown[])[0]));
    for (const url of urls) expect(url.startsWith('/arbitrary/')).toBe(true);
  });

  it('surfaces a loader crash as an error snapshot rather than an empty archive', async () => {
    const loader = vi.fn().mockRejectedValue(new Error('boom'));
    renderProvider(loader);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('error'));
  });

  it('performs read-only discovery without ever requesting an account', async () => {
    const bridge = vi.fn().mockResolvedValue([]);
    Object.defineProperty(window, 'qortalRequest', {
      configurable: true,
      writable: true,
      value: bridge,
    });

    render(
      <BridgeProvider environment={HOSTED}>
        <ContentProvider>
          <Probe />
        </ContentProvider>
      </BridgeProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).not.toHaveTextContent('loading'));

    const actions = bridge.mock.calls.map((call) => (call[0] as { action: string }).action);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions).not.toContain('GET_USER_ACCOUNT');
    expect(actions).not.toContain('GET_PRIMARY_NAME');
    // Reads only: search for discovery, never a write/publish action.
    for (const action of actions) {
      expect(['SEARCH_QDN_RESOURCES', 'FETCH_QDN_RESOURCE']).toContain(action);
    }
  });
});
