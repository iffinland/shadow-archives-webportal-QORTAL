import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';

import { AppProviders } from '../../app/providers';
import { makeEnvironment } from '../../test/environment';
import { makeArchiveSnapshot, makeListingFixture } from '../../test/fixtures/content';
import type { ArchiveSnapshot } from '../../services';
import type { CatalogListing } from '../../domain';
import { TopLists } from './TopLists';

/** Published render context without the host bridge: scoped, read-only, no auth. */
const PUBLISHED = makeEnvironment({
  context: 'render',
  service: 'APP',
  name: 'Shadow%20Archives',
  publisherName: 'Shadow Archives',
  base: '/render/APP/Shadow%20Archives',
  baseWithPath: '/render/APP/Shadow%20Archives',
});

/** Eight posts and eight videos, newest first, as the read pipeline would sort them. */
const POSTS: CatalogListing[] = Array.from({ length: 8 }, (_, index) =>
  makeListingFixture({
    id: `post0000000${index + 1}`,
    type: 'blog-post',
    identifier: `saw_post_post0000000${index + 1}`,
    title: `Post ${index + 1}`,
    slug: `post-${index + 1}`,
    updatedAt: 1_700_000_900_000 - index,
    partitionIdentifier: 'saw_cat_post_p001',
  }),
);

const VIDEOS: CatalogListing[] = Array.from({ length: 8 }, (_, index) =>
  makeListingFixture({
    id: `vid00000000${index + 1}`,
    type: 'video',
    identifier: `saw_vid_vid00000000${index + 1}`,
    title: `Video ${index + 1}`,
    slug: `video-${index + 1}`,
    durationSeconds: 90,
    updatedAt: 1_700_000_800_000 - index,
    partitionIdentifier: 'saw_cat_vid_p001',
  }),
);

const SNAPSHOT: ArchiveSnapshot = makeArchiveSnapshot({ listings: [...POSTS, ...VIDEOS] });
const loader = () => Promise.resolve(SNAPSHOT);

function renderTopLists() {
  const router = createMemoryRouter([{ path: '/', element: <TopLists /> }], {
    initialEntries: ['/'],
  });
  return render(
    <AppProviders environment={PUBLISHED} archiveLoader={loader}>
      <RouterProvider router={router} />
    </AppProviders>,
  );
}

/**
 * jsdom reports zero geometry, so motion stays off unless a test forces an
 * overflow measurement. Returns a restore function; always call it in `finally`.
 */
function forceOverflow() {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  const scrollHeight = Object.getOwnPropertyDescriptor(proto, 'scrollHeight');
  const clientHeight = Object.getOwnPropertyDescriptor(proto, 'clientHeight');
  Object.defineProperty(proto, 'scrollHeight', { configurable: true, get: () => 1000 });
  Object.defineProperty(proto, 'clientHeight', { configurable: true, get: () => 100 });
  return () => {
    if (scrollHeight) Object.defineProperty(proto, 'scrollHeight', scrollHeight);
    else Reflect.deleteProperty(proto, 'scrollHeight');
    if (clientHeight) Object.defineProperty(proto, 'clientHeight', clientHeight);
    else Reflect.deleteProperty(proto, 'clientHeight');
  };
}

function setReducedMotion(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

async function topListsReady() {
  await screen.findByRole('link', { name: 'Post 1' });
  await screen.findByRole('link', { name: 'Video 1' });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TopListPanel latest-six selection', () => {
  it('lists exactly the six latest posts, in order, with in-app detail links', async () => {
    renderTopLists();
    const posts = await screen.findByRole('region', { name: 'Top Posts' });
    await waitFor(() => expect(within(posts).getAllByRole('link')).toHaveLength(6));

    const links = within(posts).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Post 1',
      'Post 2',
      'Post 3',
      'Post 4',
      'Post 5',
      'Post 6',
    ]);
    links.forEach((link, index) => {
      expect(link).toHaveAttribute('href', `/blog/post0000000${index + 1}`);
    });
    // The two oldest posts are beyond the latest-six cap.
    expect(within(posts).queryByText('Post 7')).not.toBeInTheDocument();
    expect(within(posts).queryByText('Post 8')).not.toBeInTheDocument();
  });

  it('lists exactly the six latest videos and keeps the two kinds separate', async () => {
    renderTopLists();
    const videos = await screen.findByRole('region', { name: 'Top Videos' });
    await waitFor(() => expect(within(videos).getAllByRole('link')).toHaveLength(6));

    const links = within(videos).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual([
      'Video 1',
      'Video 2',
      'Video 3',
      'Video 4',
      'Video 5',
      'Video 6',
    ]);
    links.forEach((link, index) => {
      expect(link).toHaveAttribute('href', `/videos/vid00000000${index + 1}`);
    });

    // No cross-mixing: post titles never leak into the video box (or the reverse).
    const posts = screen.getByRole('region', { name: 'Top Posts' });
    expect(within(videos).queryByText(/^Post /)).not.toBeInTheDocument();
    expect(within(posts).queryByText(/^Video /)).not.toBeInTheDocument();
  });

  it('renders titles only: no thumbnails, ranks, metadata or cards', async () => {
    renderTopLists();
    const posts = await screen.findByRole('region', { name: 'Top Posts' });
    await waitFor(() => expect(within(posts).getAllByRole('link')).toHaveLength(6));

    expect(posts.querySelectorAll('img')).toHaveLength(0);
    expect(posts.querySelectorAll('.sa-top-list__rank')).toHaveLength(0);
    expect(posts.querySelectorAll('.sa-card')).toHaveLength(0);
    expect(within(posts).queryByRole('heading', { name: 'Top Posts' })).toBeInTheDocument();
  });
});

describe('continuous vertical ticker loop', () => {
  it('appends one hidden, inert duplicate copy while the motion loop runs', async () => {
    const restore = forceOverflow();
    try {
      renderTopLists();
      const posts = await screen.findByRole('region', { name: 'Top Posts' });
      await waitFor(() => expect(posts.querySelectorAll('.sa-autoscroll__copy')).toHaveLength(2));

      const copies = posts.querySelectorAll('.sa-autoscroll__copy');
      expect(copies).toHaveLength(2);
      const clone = copies[1] as HTMLElement;
      expect(clone).toHaveAttribute('aria-hidden', 'true');
      expect(clone).toHaveAttribute('inert');
      // The duplicate never adds a second announcement of the same title.
      expect(within(posts).getAllByRole('link')).toHaveLength(6);
      // Both boxes use the one shared ticker implementation.
      const videos = screen.getByRole('region', { name: 'Top Videos' });
      expect(videos.querySelectorAll('.sa-autoscroll__copy')).toHaveLength(2);
    } finally {
      restore();
    }
  });

  it('keeps a single usable copy and no motion under prefers-reduced-motion', async () => {
    setReducedMotion(true);
    const restore = forceOverflow();
    try {
      renderTopLists();
      const posts = await screen.findByRole('region', { name: 'Top Posts' });
      await waitFor(() => expect(within(posts).getAllByRole('link')).toHaveLength(6));

      const viewport = within(posts).getByRole('group', { name: 'Top Posts ticker' });
      expect(viewport).toHaveAttribute('data-motion', 'off');
      expect(posts.querySelectorAll('.sa-autoscroll__copy')).toHaveLength(1);
      expect(within(posts).getAllByRole('link')).toHaveLength(6);
    } finally {
      restore();
    }
  });

  it('pauses the loop on pointer interaction', async () => {
    const restore = forceOverflow();
    try {
      renderTopLists();
      await topListsReady();
      const viewport = screen.getByRole('group', { name: 'Top Posts ticker' });
      expect(viewport).toHaveAttribute('data-paused', 'false');

      fireEvent.pointerDown(viewport);
      expect(viewport).toHaveAttribute('data-paused', 'true');
    } finally {
      restore();
    }
  });

  it('pauses the loop while the document is hidden', async () => {
    const restore = forceOverflow();
    const hidden = Object.getOwnPropertyDescriptor(document, 'hidden');
    try {
      renderTopLists();
      await topListsReady();
      const viewport = screen.getByRole('group', { name: 'Top Posts ticker' });
      expect(viewport).toHaveAttribute('data-paused', 'false');

      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(viewport).toHaveAttribute('data-paused', 'true');
    } finally {
      if (hidden) Object.defineProperty(document, 'hidden', hidden);
      else Reflect.deleteProperty(document, 'hidden');
      restore();
    }
  });

  it('removes its document listener on unmount (no accumulation)', async () => {
    const removeSpy = vi.spyOn(document, 'removeEventListener');
    const restore = forceOverflow();
    try {
      const view = renderTopLists();
      await topListsReady();
      view.unmount();
    } finally {
      restore();
    }
    expect(removeSpy).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });
});
