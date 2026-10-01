import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderApp } from '../../test/utils';
import { makeEnvironment } from '../../test/environment';
import { resetContentCache } from '../../services';
import {
  TEST_PUBLISHER,
  TEST_VIDEO_FIXTURE,
  TEST_VIDEO_ID,
  makeArchiveSnapshot,
} from '../../test/fixtures/content';

/**
 * Video detail playback.
 *
 * The published read-only runtime injects the identity but has no host bridge, so
 * the detail route resolves the entity over the verified same-origin REST routes
 * and the player points at the same-origin `/arbitrary/<service>/<name>/<id>` path.
 * Rendering the page must never request the video bytes themselves.
 */

const PUBLISHED_RENDER_NO_BRIDGE = makeEnvironment({
  context: 'render',
  service: 'APP',
  name: 'Shadow%20Archives',
  publisherName: 'Shadow Archives',
  base: '/render/APP/Shadow%20Archives',
  baseWithPath: '/render/APP/Shadow%20Archives',
});

const ENTITY_IDENTIFIER = `saw_vid_${TEST_VIDEO_ID}`;
const MEDIA_PATH = `/arbitrary/VIDEO/${encodeURIComponent(TEST_PUBLISHER)}/saw_vid_${TEST_VIDEO_ID}`;
const POSTER_PATH = `/arbitrary/THUMBNAIL/${encodeURIComponent(TEST_PUBLISHER)}/saw_thumb_${TEST_VIDEO_ID}`;

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
      text: () => Promise.resolve(JSON.stringify(TEST_VIDEO_FIXTURE)),
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return { fetchMock, calls };
}

afterEach(() => {
  resetContentCache();
  vi.unstubAllGlobals();
});

describe('Video detail playback', () => {
  it('renders a native player bound to the stored QDN media without fetching bytes', async () => {
    const { calls } = installSameOriginNode();

    renderApp({
      route: `/videos/${TEST_VIDEO_ID}`,
      environment: PUBLISHED_RENDER_NO_BRIDGE,
      archiveLoader: () => Promise.resolve(makeArchiveSnapshot({ listings: [] })),
    });

    expect(await screen.findByRole('heading', { name: 'Field footage' })).toBeInTheDocument();

    const player = screen.getByLabelText('Play Field footage');
    expect(player.tagName).toBe('VIDEO');
    expect(player).toHaveAttribute('src', MEDIA_PATH);
    expect(player).toHaveAttribute('poster', POSTER_PATH);
    expect(player).toHaveAttribute('preload', 'metadata');
    expect(player).toHaveAttribute('controls');
    expect(player).not.toHaveAttribute('autoplay');

    // Duration is rendered from the entity, not from the media bytes.
    expect(screen.getAllByText('1:34').length).toBeGreaterThan(0);

    // A detail visit must not download the video (QDN serves it through the
    // player only when the owner/visitor presses play).
    expect(calls.some((url) => url.startsWith('/arbitrary/VIDEO/'))).toBe(false);
    expect(
      calls.some(
        (url) =>
          url === `/arbitrary/DOCUMENT/${encodeURIComponent(TEST_PUBLISHER)}/${ENTITY_IDENTIFIER}`,
      ),
    ).toBe(true);
  });
});
