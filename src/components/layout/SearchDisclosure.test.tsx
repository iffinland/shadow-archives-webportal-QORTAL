import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from '../../test/utils';

describe('SearchDisclosure', () => {
  it('starts collapsed with the input hidden and correctly labelled', () => {
    renderApp({ route: '/' });

    const toggle = screen.getByRole('button', { name: 'Search the archive' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('search', { hidden: true })).toHaveAttribute('hidden');
  });

  it('expands, focuses the input and collapses on Escape', async () => {
    const user = userEvent.setup();
    renderApp({ route: '/' });

    await user.click(screen.getByRole('button', { name: 'Search the archive' }));

    const input = screen.getByRole('searchbox', { name: 'Search Shadow Archives' });
    expect(screen.getByRole('search')).not.toHaveAttribute('hidden');
    expect(input).toBeVisible();
    expect(input).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Close search' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    await user.keyboard('{Escape}');

    expect(screen.getByRole('search', { hidden: true })).toHaveAttribute('hidden');
    expect(screen.getByRole('button', { name: 'Search the archive' })).toHaveFocus();
  });

  it('navigates to the search route with the query in the URL', async () => {
    const user = userEvent.setup();
    const { router } = renderApp({ route: '/' });

    await user.click(screen.getByRole('button', { name: 'Search the archive' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search Shadow Archives' }), 'redaction');
    await user.keyboard('{Enter}');

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/search');
    });
    expect(router.state.location.search).toBe('?q=redaction');
    expect(await screen.findByRole('heading', { level: 1, name: 'Search' })).toBeInTheDocument();
  });

  it('ignores an empty submission instead of navigating', async () => {
    const user = userEvent.setup();
    const { router } = renderApp({ route: '/' });

    await user.click(screen.getByRole('button', { name: 'Search the archive' }));
    await user.keyboard('   {Enter}');

    expect(router.state.location.pathname).toBe('/');
  });
});
