import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';

import { renderApp } from '../../test/utils';
import { makeEnvironment } from '../../test/environment';
import { resetContentCache } from '../../services';
import {
  TEST_BLOG_FIXTURE,
  TEST_BLOG_ID,
  TEST_PUBLISHER,
  makeArchiveSnapshot,
} from '../../test/fixtures/content';

/**
 * Blog detail quick actions in the published read-only runtime.
 *
 * The detail view must reuse the same engagement controls as the card and share
 * a canonical Qortal deep link (never the local node HTTP URL).
 */

const PUBLISHED_RENDER_NO_BRIDGE = makeEnvironment({
  context: 'render',
  service: 'APP',
  name: 'Shadow%20Archives',
  publisherName: 'Shadow Archives',
  base: '/render/APP/Shadow%20Archives',
  baseWithPath: '/render/APP/Shadow%20Archives',
});

const ENTITY_IDENTIFIER = `saw_post_${TEST_BLOG_ID}`;

function installSameOriginNode() {
  const fetchMock = vi.fn((url: string) => {
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
      text: () => Promise.resolve(JSON.stringify(TEST_BLOG_FIXTURE)),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock };
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard');
  resetContentCache();
  vi.unstubAllGlobals();
});

describe('Blog post detail quick actions', () => {
  it('renders the shared engagement controls and shares a canonical Qortal link', async () => {
    installSameOriginNode();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    renderApp({
      route: `/blog/${TEST_BLOG_ID}`,
      environment: PUBLISHED_RENDER_NO_BRIDGE,
      archiveLoader: () => Promise.resolve(makeArchiveSnapshot({ listings: [] })),
    });

    expect(await screen.findByRole('heading', { name: 'Redaction notes' })).toBeInTheDocument();

    const actions = document.querySelector('.sa-card__actions');
    expect(actions).toHaveAttribute('aria-label', 'Actions for Redaction notes');
    expect(screen.getByRole('button', { name: 'Like' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Comment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tip' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Share' }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(`qortal://APP/Shadow%20Archives/blog/${TEST_BLOG_ID}`),
    );
    expect(writeText.mock.calls[0][0]).not.toMatch(/^https?:\/\//);
  }, 15_000);
});
