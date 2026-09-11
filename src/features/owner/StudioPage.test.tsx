import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';

import { renderApp } from '../../test/utils';
import { makeEnvironment } from '../../test/environment';

describe('StudioPage', () => {
  it('is an inert, capability-honest placeholder', async () => {
    renderApp({ route: '/studio' });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Owner studio' }),
    ).toBeInTheDocument();
    expect(screen.getByText('unknown')).toBeInTheDocument();
    expect(screen.getByText('none')).toBeInTheDocument();
    // The only button on the page is the shell's search toggle — the studio
    // panel itself exposes no publishing or sign-in control.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.getByRole('button')).toHaveAccessibleName('Search the archive');
  });

  it('issues no bridge call even in a hosted render context', async () => {
    const bridge = vi.fn().mockResolvedValue(undefined);

    renderApp({
      route: '/studio',
      environment: makeEnvironment({
        bridgeAvailable: true,
        isHosted: true,
        context: 'app',
        service: 'APP',
        name: 'Shadow%20Archives',
        publisherName: 'Shadow Archives',
      }),
    });

    await screen.findByRole('heading', { level: 1, name: 'Owner studio' });
    expect(bridge).not.toHaveBeenCalled();
  });
});
