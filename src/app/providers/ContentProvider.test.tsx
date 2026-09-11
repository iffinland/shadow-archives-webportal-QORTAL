import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

import { BridgeProvider } from './BridgeProvider';
import { ContentProvider, useContent } from './ContentProvider';
import { resetContentCache } from '../../services';
import { makeEnvironment } from '../../test/environment';
import { makeArchiveSnapshot, makeListingFixture } from '../../test/fixtures/content';
import type { ArchiveSnapshot, LoadArchiveOptions, PublisherScope } from '../../services';

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
  Reflect.deleteProperty(window, 'qortalRequest');
});

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
