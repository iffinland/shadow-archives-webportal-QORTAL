import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { renderApp } from '../../test/utils';
import { makeEnvironment } from '../../test/environment';
import { resetContentCache } from '../../services';
import {
  TEST_ITEM_FIXTURE,
  TEST_ITEM_ID,
  TEST_PUBLISHER,
  makeArchiveSnapshot,
} from '../../test/fixtures/content';

/**
 * Content detail loading in the published read-only runtime.
 *
 * The observed owner runtime injects the identity but has no host bridge, so the
 * detail route must resolve and fetch the authoritative entity over the verified
 * same-origin REST routes instead of failing as unavailable.
 */

const PUBLISHED_RENDER_NO_BRIDGE = makeEnvironment({
  context: 'render',
  service: 'APP',
  name: 'Shadow%20Archives',
  publisherName: 'Shadow Archives',
  base: '/render/APP/Shadow%20Archives',
  baseWithPath: '/render/APP/Shadow%20Archives',
});

const ENTITY_IDENTIFIER = `saw_img_${TEST_ITEM_ID}`;

function installSameOriginNode() {
  const calls: string[] = [];
  const fetchMock = vi.fn((url: string) => {
    calls.push(String(url));
    if (String(url).startsWith('/arbitrary/resources/search')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        text: () =>
          Promise.resolve(
            JSON.stringify([
              {
                service: 'DOCUMENT',
                name: TEST_PUBLISHER,
                identifier: ENTITY_IDENTIFIER,
                created: 1,
                updated: 2,
                size: 10,
                status: 'READY',
              },
            ]),
          ),
      });
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(TEST_ITEM_FIXTURE)),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
  resetContentCache();
  vi.unstubAllGlobals();
});

describe('Gallery item detail in the published read-only runtime', () => {
  it('loads the authoritative entity over same-origin REST without a bridge', async () => {
    const { calls } = installSameOriginNode();

    renderApp({
      route: `/gallery/item/${TEST_ITEM_ID}`,
      environment: PUBLISHED_RENDER_NO_BRIDGE,
      archiveLoader: () => Promise.resolve(makeArchiveSnapshot({ listings: [] })),
    });

    expect(await screen.findByRole('heading', { name: 'Plate 01' })).toBeInTheDocument();
    expect(screen.getByText('A stored plate.')).toBeInTheDocument();
    expect(screen.queryByText(/No production Qortal publisher identity/)).not.toBeInTheDocument();

    expect(calls.some((url) => url.startsWith('/arbitrary/resources/search'))).toBe(true);
    expect(
      calls.some((url) => url === `/arbitrary/DOCUMENT/Shadow%20Archives/${ENTITY_IDENTIFIER}`),
    ).toBe(true);

    // The detail view reuses the shared card quick actions.
    const actions = document.querySelector('.sa-card__actions');
    expect(actions).toHaveAttribute('aria-label', 'Actions for Plate 01');
    expect(screen.getByRole('button', { name: 'Like' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Comment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tip' })).toBeInTheDocument();
  });

  it('shares a canonical Qortal deep link from a gallery item detail view', async () => {
    installSameOriginNode();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    renderApp({
      route: `/gallery/item/${TEST_ITEM_ID}`,
      environment: PUBLISHED_RENDER_NO_BRIDGE,
      archiveLoader: () => Promise.resolve(makeArchiveSnapshot({ listings: [] })),
    });

    await screen.findByRole('heading', { name: 'Plate 01' });
    fireEvent.click(screen.getByRole('button', { name: 'Share' }));

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `qortal://APP/Shadow%20Archives/gallery/item/${TEST_ITEM_ID}`,
      ),
    );
    expect(writeText.mock.calls[0][0]).not.toMatch(/^https?:\/\//);
  });

  it('does not invent content in a plain browser', async () => {
    const { fetchMock } = installSameOriginNode();

    renderApp({
      route: `/gallery/item/${TEST_ITEM_ID}`,
      environment: makeEnvironment(),
      archiveLoader: () => Promise.resolve(makeArchiveSnapshot({ listings: [] })),
    });

    expect(await screen.findByRole('heading', { name: 'Gallery item' })).toBeInTheDocument();
    // A plain browser has no published identity, so no same-origin QDN read is issued.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Plate 01' })).not.toBeInTheDocument();
  });
});
