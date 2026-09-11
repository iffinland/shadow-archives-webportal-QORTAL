import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';

import { renderApp } from '../../test/utils';
import { makeEnvironment } from '../../test/environment';
import {
  TEST_BLOG_ID,
  TEST_ITEM_ID,
  TEST_VIDEO_ID,
  makeArchiveSnapshot,
  makeListingFixture,
} from '../../test/fixtures/content';

const HOSTED = makeEnvironment({
  bridgeAvailable: true,
  isHosted: true,
  context: 'app',
  service: 'APP',
  name: 'Shadow%20Archives',
  publisherName: 'Shadow Archives',
  base: '/render/APP/Shadow%20Archives',
});

const LISTINGS = [
  makeListingFixture(),
  makeListingFixture({
    id: TEST_VIDEO_ID,
    type: 'video',
    identifier: `saw_vid_${TEST_VIDEO_ID}`,
    slug: 'field-footage',
    title: 'Field footage',
    excerpt: 'Stored metadata only.',
    durationSeconds: 93,
    partitionIdentifier: 'saw_cat_vid_p001',
  }),
  makeListingFixture({
    id: TEST_ITEM_ID,
    type: 'gallery-item',
    identifier: `saw_img_${TEST_ITEM_ID}`,
    slug: 'plate-01',
    title: 'Plate 01',
    excerpt: '',
    partitionIdentifier: 'saw_cat_img_p001',
  }),
];

function loader() {
  return Promise.resolve(makeArchiveSnapshot({ listings: LISTINGS }));
}

afterEach(() => {
  Reflect.deleteProperty(window, 'qortalRequest');
});

describe('HomePage with a validated archive snapshot', () => {
  it('renders Latest Posts, Latest Videos and Gallery from one bounded read', async () => {
    const bridge = vi.fn().mockResolvedValue([]);
    Object.defineProperty(window, 'qortalRequest', {
      configurable: true,
      writable: true,
      value: bridge,
    });

    renderApp({ route: '/', environment: HOSTED, archiveLoader: loader });

    const posts = await screen.findByRole('region', { name: 'Latest Posts' });
    expect(within(posts).getByRole('heading', { name: 'Redaction notes' })).toBeInTheDocument();
    expect(within(posts).getByRole('link', { name: 'Redaction notes' })).toHaveAttribute(
      'href',
      `/blog/${TEST_BLOG_ID}`,
    );

    const videos = screen.getByRole('region', { name: 'Latest Videos' });
    expect(within(videos).getByRole('link', { name: 'Field footage' })).toHaveAttribute(
      'href',
      `/videos/${TEST_VIDEO_ID}`,
    );

    const gallery = screen.getByRole('region', { name: 'Latest from the Gallery' });
    expect(within(gallery).getByRole('link', { name: /Plate 01/ })).toHaveAttribute(
      'href',
      `/gallery/item/${TEST_ITEM_ID}`,
    );

    // The injected loader is the data seam, so no bridge read is issued at all;
    // in particular, browsing never authenticates.
    expect(bridge).not.toHaveBeenCalled();
    expect(screen.queryByText(/GET_USER_ACCOUNT/)).not.toBeInTheDocument();
  });

  it('keeps Top Posts and Top Videos honest instead of fabricating a ranking', async () => {
    renderApp({ route: '/', environment: HOSTED, archiveLoader: loader });
    await screen.findByRole('region', { name: 'Latest Posts' });

    const messages = screen.getAllByText(
      'Ranking unavailable until engagement data is implemented.',
    );
    expect(messages.length).toBeGreaterThanOrEqual(1);
  });

  it('shows an honest unavailable state (not empty) when the loader reports failure', async () => {
    renderApp({
      route: '/',
      environment: HOSTED,
      archiveLoader: () =>
        Promise.resolve(
          makeArchiveSnapshot({
            status: 'error',
            source: 'none',
            listings: [],
            message: 'The archive catalog could not be read.',
          }),
        ),
    });

    await screen.findByRole('region', { name: 'Latest Posts' });
    // Wait for the settled state, then assert no real content card was fabricated.
    expect(
      (await screen.findAllByText('The archive catalog could not be read.')).length,
    ).toBeGreaterThan(0);
    expect(document.querySelectorAll('.sa-card:not(.sa-card--skeleton)')).toHaveLength(0);
  });
});
