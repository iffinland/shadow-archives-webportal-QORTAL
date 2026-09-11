import { describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';

import { renderApp } from '../../test/utils';

describe('AppShell', () => {
  it('renders the approved shell landmarks and skip link', () => {
    renderApp({ route: '/' });

    const skipLink = screen.getByRole('link', { name: 'Skip to content' });
    expect(skipLink).toHaveAttribute('href', '#sa-main');
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveAttribute('id', 'sa-main');
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('links the primary actions to the configured Qortal apps', () => {
    renderApp({ route: '/' });

    const actions = screen.getByRole('navigation', { name: 'Qortal apps and search' });
    expect(within(actions).getByRole('link', { name: /Q-Tube/ })).toHaveAttribute(
      'href',
      'qortal://APP/Q-Tube',
    );
    expect(within(actions).getByRole('link', { name: /SubWire/ })).toHaveAttribute(
      'href',
      'qortal://APP/SubWire',
    );
    expect(within(actions).getByRole('link', { name: /Quitter/ })).toHaveAttribute(
      'href',
      'qortal://APP/Quitter',
    );
  });

  it('marks the active route with aria-current', () => {
    renderApp({ route: '/videos' });

    const nav = screen.getByRole('navigation', { name: 'Site sections' });
    expect(within(nav).getByRole('link', { name: 'Videos' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
  });

  it('renders the header top panels without thumbnails', () => {
    renderApp({ route: '/' });

    expect(screen.getByRole('region', { name: 'Top Posts' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Top Videos' })).toBeInTheDocument();
    // Only the banner artwork is an image; the panels carry no thumbnails.
    // (The banner image is decorative: alt="" + the link's accessible name.)
    expect(document.querySelectorAll('img')).toHaveLength(1);
  });

  it('never requests authentication or publishes while rendering the shell', async () => {
    const bridge = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, 'qortalRequest', {
      configurable: true,
      writable: true,
      value: bridge,
    });

    try {
      renderApp({ route: '/' });
      await screen.findByRole('heading', { level: 1, name: 'Shadow Archives' });

      expect(bridge).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(window as unknown as Record<string, unknown>, 'qortalRequest');
    }
  });

  it('does not expose owner studio navigation to visitors', () => {
    renderApp({ route: '/' });

    expect(screen.queryByRole('link', { name: /studio/i })).not.toBeInTheDocument();
  });
});
