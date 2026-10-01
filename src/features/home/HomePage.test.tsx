import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { render, screen } from '@testing-library/react';

import { AuthProvider } from '../../app/providers/AuthProvider';
import { BridgeProvider } from '../../app/providers/BridgeProvider';
import { renderApp } from '../../test/utils';
import { makeEnvironment } from '../../test/environment';
import { LatestPostsSection } from './components/LatestPostsSection';

describe('HomePage', () => {
  it('renders every home region as an honest empty state', async () => {
    renderApp({ route: '/', environment: makeEnvironment() });

    expect(await screen.findByRole('region', { name: 'Latest Posts' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Latest Videos' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Latest from the Gallery' })).toBeInTheDocument();

    expect(screen.getByText('No posts loaded')).toBeInTheDocument();
    expect(screen.getByText('No videos loaded')).toBeInTheDocument();
    expect(screen.getByText('No gallery media loaded')).toBeInTheDocument();
  });

  it('does not fabricate engagement counts or QDN content', async () => {
    renderApp({ route: '/', environment: makeEnvironment() });

    await screen.findByRole('region', { name: 'Latest Posts' });
    expect(screen.queryByText(/\d+\s*(likes?|comments?|tips?)/i)).not.toBeInTheDocument();
    // Skeleton shells are loading UI, not content: assert no real card rendered.
    expect(document.querySelectorAll('.sa-card:not(.sa-card--skeleton)')).toHaveLength(0);
  });

  it('renders card geometry when content is supplied (future catalog shape)', () => {
    render(
      <BridgeProvider environment={makeEnvironment()}>
        <AuthProvider>
          <MemoryRouter>
            <LatestPostsSection
              state={{
                status: 'ready',
                items: [
                  {
                    id: 'saw_post_abc',
                    kind: 'post',
                    title: 'Redaction notes',
                    description: 'A short description.',
                    href: '/blog/saw_post_abc',
                    media: { src: '/thumb.webp', alt: 'Cover', width: 16, height: 9 },
                  },
                ],
              }}
            />
          </MemoryRouter>
        </AuthProvider>
      </BridgeProvider>,
    );

    expect(screen.getByRole('heading', { name: 'Redaction notes' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Redaction notes' })).toHaveAttribute(
      'href',
      '/blog/saw_post_abc',
    );
    expect(screen.getByText('A short description.')).toBeInTheDocument();
    expect(screen.getByAltText('Cover')).toBeInTheDocument();
    expect(screen.getByAltText('Cover')).toHaveAttribute('loading', 'lazy');
    // Every card exposes the same real engagement controls.
    const actions = document.querySelector('.sa-card__actions');
    expect(actions).not.toBeNull();
    expect(actions).toHaveAttribute('aria-label', 'Actions for Redaction notes');
    expect(screen.getByRole('button', { name: 'Like' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Comment' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tip' })).toBeInTheDocument();
  });
});
