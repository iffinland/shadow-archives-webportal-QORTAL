import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';

import { renderApp } from '../../test/utils';

const CASES: ReadonlyArray<readonly [string, string]> = [
  ['/', 'Shadow Archives'],
  ['/blog', 'Blog'],
  ['/blog/saw_post_example', 'Blog post'],
  ['/videos', 'Videos'],
  ['/videos/saw_vid_example', 'Video'],
  ['/gallery', 'Gallery'],
  ['/gallery/album/saw_album_example', 'Gallery album'],
  ['/gallery/item/saw_img_example', 'Gallery item'],
  ['/gallery/saw_img_example', 'Gallery item'],
  ['/about', 'About Shadow Archives'],
  ['/contact', 'Contact'],
  ['/category/field-notes', 'Category'],
  ['/tag/archive', 'Tag'],
  ['/search?q=redaction', 'Search'],
  ['/studio', 'Owner studio'],
  ['/this-route-does-not-exist', 'Page not found'],
];

describe('route table', () => {
  it.each(CASES)('resolves %s with an h1 named "%s"', async (route, heading) => {
    renderApp({ route });

    // Lazy route chunks may include heavy read-only dependencies (for example
    // DOMPurify in the blog-detail chunk), so allow more than the default 1s.
    expect(
      await screen.findByRole('heading', { level: 1, name: heading }, { timeout: 8000 }),
    ).toBeInTheDocument();
  });

  it('renders the persistent shell around a route', async () => {
    renderApp({ route: '/blog' });

    await screen.findByRole('heading', { level: 1, name: 'Blog' });
    // `@testing-library/dom` maps every <header> to role=banner, including the
    // in-page <header> inside <main>, so target the shell header directly.
    expect(document.querySelector('.sa-site-header')).not.toBeNull();
    expect(screen.getByRole('navigation', { name: 'Site sections' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('keeps the shell mounted when a route is still loading', () => {
    renderApp({ route: '/blog' });

    // The shell is present synchronously; only the outlet is suspended.
    expect(screen.getByRole('navigation', { name: 'Site sections' })).toBeInTheDocument();
    expect(document.querySelector('.sa-site-header')).not.toBeNull();
  });
});
