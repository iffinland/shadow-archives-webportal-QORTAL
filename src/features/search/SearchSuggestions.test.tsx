import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { CatalogListing } from '../../domain';
import { makeEnvironment } from '../../test/environment';
import { makeArchiveSnapshot, makeListingFixture } from '../../test/fixtures/content';
import { renderApp } from '../../test/utils';

// Typing drives many React re-renders through the persistent shell; allow more
// than the default 5s under parallel test load.
vi.setConfig({ testTimeout: 20_000 });

const HOSTED = makeEnvironment({
  bridgeAvailable: true,
  isHosted: true,
  context: 'render',
  service: 'APP',
  name: 'Shadow%20Archives',
  publisherName: 'Shadow Archives',
});

const LISTINGS: CatalogListing[] = [
  makeListingFixture({
    id: 'blog00000001',
    identifier: 'saw_post_blog00000001',
    type: 'blog-post',
    title: 'Redaction notes',
    slug: 'redaction-notes',
    excerpt: 'A short archive excerpt.',
    categories: [],
    tags: [],
  }),
  makeListingFixture({
    id: 'vid000000001',
    identifier: 'saw_vid_vid000000001',
    type: 'video',
    title: 'Field footage',
    slug: 'field-footage',
    excerpt: '',
    durationSeconds: 93,
    categories: [],
    tags: [],
  }),
  makeListingFixture({
    id: 'item00000001',
    identifier: 'saw_img_item00000001',
    type: 'gallery-item',
    title: 'Redaction plate',
    slug: 'redaction-plate',
    excerpt: '',
    categories: [],
    tags: [],
  }),
  makeListingFixture({
    id: 'evil00000001',
    identifier: 'saw_post_evil00000001',
    type: 'blog-post',
    title: '<img src=x onerror=alert(1)> notes',
    slug: 'evil-notes',
    excerpt: '',
    categories: [],
    tags: [],
  }),
];

function setup() {
  const archiveLoader = vi.fn(async () => makeArchiveSnapshot({ listings: LISTINGS }));
  const utils = renderApp({ route: '/', environment: HOSTED, archiveLoader });
  return { ...utils, archiveLoader };
}

async function openSearch() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Search the archive' }));
  return user;
}

function input(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Search Shadow Archives' });
}

describe('live search suggestions', () => {
  it('filters locally as you type without extra QDN reads', async () => {
    const { archiveLoader } = setup();
    const user = await openSearch();

    await user.type(input(), 'field');

    const listbox = await screen.findByRole('listbox', { name: 'Search suggestions' });
    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Field footage');
    // One archive load for the whole session; typing never re-queries QDN.
    expect(archiveLoader).toHaveBeenCalledTimes(1);

    await user.clear(input());
    await user.type(input(), 'redaction');
    await waitFor(() =>
      expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(2),
    );
    expect(archiveLoader).toHaveBeenCalledTimes(1);
  });

  it('highlights the matching text with a safe <mark>, never raw HTML', async () => {
    setup();
    const user = await openSearch();

    await user.type(input(), 'redaction');
    const listbox = await screen.findByRole('listbox', { name: 'Search suggestions' });
    const options = within(listbox).getAllByRole('option');
    expect(options[0].querySelector('mark')).toHaveTextContent('Redaction');

    await user.clear(input());
    await user.type(input(), 'img');
    const evil = within(screen.getByRole('listbox')).getByRole('option');
    expect(evil.querySelector('img')).toBeNull();
    expect(evil).toHaveTextContent('<img src=x onerror=alert(1)> notes');
  });

  it('shows a clear, unobtrusive no-result state', async () => {
    setup();
    const user = await openSearch();

    await user.type(input(), 'nothingmatchesthis');

    expect(await screen.findByText('No matching content')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('navigates with the keyboard and closes on route change', async () => {
    const { router } = setup();
    const user = await openSearch();

    await user.type(input(), 'redaction');
    await screen.findByRole('listbox', { name: 'Search suggestions' });

    await user.keyboard('{ArrowDown}');
    expect(within(screen.getByRole('listbox')).getAllByRole('option')[0]).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard('{ArrowDown}');
    expect(within(screen.getByRole('listbox')).getAllByRole('option')[1]).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await user.keyboard('{Enter}');

    await waitFor(() => expect(router.state.location.pathname).toBe('/gallery/item/item00000001'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('selects a suggestion by mouse/touch', async () => {
    const { router } = setup();
    const user = await openSearch();

    await user.type(input(), 'field');
    const option = await screen.findByRole('option', { name: /Field footage/ });
    await user.click(option);

    await waitFor(() => expect(router.state.location.pathname).toBe('/videos/vid000000001'));
  });

  it('dismisses the list first on Escape, then closes the control', async () => {
    setup();
    const user = await openSearch();

    await user.type(input(), 'redaction');
    await screen.findByRole('listbox', { name: 'Search suggestions' });

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    // The input is still open with its text intact.
    expect(input()).toBeVisible();
    expect(input()).toHaveValue('redaction');

    await user.keyboard('{Escape}');
    expect(screen.getByRole('search', { hidden: true })).toHaveAttribute('hidden');
  });

  it('dismisses the list on outside interaction without losing the input', async () => {
    setup();
    const user = await openSearch();

    await user.type(input(), 'redaction');
    await screen.findByRole('listbox', { name: 'Search suggestions' });

    await user.click(document.body);

    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    expect(input()).toHaveValue('redaction');
  });
});
