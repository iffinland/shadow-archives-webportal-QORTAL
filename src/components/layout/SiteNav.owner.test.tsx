import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from '../../test/utils';
import { makeEnvironment } from '../../test/environment';
import { resetAuthSession } from '../../qortal/auth';
import type { ArchiveSnapshot } from '../../services';

const OWNER = 'QPw4vnk5CBDWkgdXB4vUXCc4DXGEjHVxCA';
const OTHER = 'QOtherAccountAddressForTests1234567890';
const PUBLISHER = 'Shadow Archives';

const HOSTED = makeEnvironment({
  bridgeAvailable: true,
  isHosted: true,
  context: 'app',
  service: 'APP',
  name: 'Shadow%20Archives',
  publisherName: PUBLISHER,
});

const EMPTY_ARCHIVE: ArchiveSnapshot = {
  status: 'empty',
  source: 'none',
  listings: [],
  taxonomy: { categories: [], tags: [] },
  compiledAt: null,
  stale: false,
  partial: false,
  message: null,
  error: null,
  diagnostics: [],
};
const archiveLoader = async () => EMPTY_ARCHIVE;

interface BridgeHandlers {
  readonly account?: QortalAccountLike;
  readonly names?: readonly { name: string; owner: string }[];
  readonly nameOwner?: string;
}
interface QortalAccountLike {
  readonly address: string;
  readonly publicKey: string;
}

function installBridge(handlers: BridgeHandlers = {}) {
  const mock = vi.fn((payload: Record<string, unknown>) => {
    switch (payload.action) {
      case 'GET_USER_ACCOUNT':
        return Promise.resolve(handlers.account ?? { address: OWNER, publicKey: 'K' });
      case 'GET_ACCOUNT_NAMES':
        return Promise.resolve(handlers.names ?? [{ name: PUBLISHER, owner: OWNER }]);
      case 'GET_NAME_DATA':
        return Promise.resolve({ name: PUBLISHER, owner: handlers.nameOwner ?? OWNER });
      case 'SEARCH_QDN_RESOURCES':
        return Promise.resolve([]);
      default:
        return Promise.reject(new Error(`Unexpected bridge action: ${String(payload.action)}`));
    }
  });
  Object.defineProperty(window, 'qortalRequest', {
    configurable: true,
    writable: true,
    value: mock,
  });
  return mock;
}

function accountCalls(bridge: ReturnType<typeof installBridge>) {
  return bridge.mock.calls.filter((call) => call[0].action === 'GET_USER_ACCOUNT');
}

function navLabels(): string[] {
  const nav = screen.getByRole('navigation', { name: 'Site sections' });
  return within(nav)
    .getAllByRole('link')
    .map((link) => (link.textContent ?? '').trim());
}

async function runOwnerFlow(): Promise<void> {
  const user = userEvent.setup();
  renderApp({ route: '/studio', environment: HOSTED, archiveLoader });
  await screen.findByRole('heading', { level: 1, name: 'Owner studio' });
  await user.click(screen.getByRole('button', { name: 'Enter owner mode' }));
  await screen.findByText('Owner capability verified');
}

beforeEach(() => {
  resetAuthSession();
});

afterEach(() => {
  resetAuthSession();
  Reflect.deleteProperty(window, 'qortalRequest');
});

describe('SiteNav — public navigation', () => {
  it('renders exactly the approved public items in order for a visitor', () => {
    installBridge({ account: { address: OTHER, publicKey: 'K' }, names: [] });
    renderApp({ route: '/', environment: HOSTED, archiveLoader });

    expect(navLabels()).toEqual(['Home', 'Blog', 'Videos', 'Gallery', 'About', 'Contact']);
  });

  it('contains no Studio link for a visitor and never requests an account', () => {
    const bridge = installBridge();
    renderApp({ route: '/', environment: HOSTED, archiveLoader });

    expect(navLabels()).not.toContain('Studio');
    expect(screen.queryByRole('link', { name: 'Studio' })).not.toBeInTheDocument();
    // Browsing may issue public reads (catalog), but never GET_USER_ACCOUNT.
    expect(accountCalls(bridge)).toHaveLength(0);
  });

  it('contains no Studio link for an authenticated non-owner', async () => {
    installBridge({
      account: { address: OTHER, publicKey: 'K' },
      names: [{ name: 'Some Other Name', owner: OTHER }],
    });
    const user = userEvent.setup();
    renderApp({ route: '/studio', environment: HOSTED, archiveLoader });
    await screen.findByRole('heading', { level: 1, name: 'Owner studio' });
    await user.click(screen.getByRole('button', { name: 'Enter owner mode' }));

    await screen.findByText('Signed in — not the owner');
    expect(navLabels()).not.toContain('Studio');
  });

  it('contains no Studio link for an account that owns no name', async () => {
    installBridge({
      account: { address: OTHER, publicKey: 'K' },
      names: [],
    });
    const user = userEvent.setup();
    renderApp({ route: '/studio', environment: HOSTED, archiveLoader });
    await screen.findByRole('heading', { level: 1, name: 'Owner studio' });
    await user.click(screen.getByRole('button', { name: 'Enter owner mode' }));

    await screen.findByText('No registered Qortal name');
    expect(navLabels()).not.toContain('Studio');
  });

  it('contains no Studio link when permission is denied', async () => {
    const bridge = vi.fn((payload: Record<string, unknown>) => {
      if (payload.action === 'GET_USER_ACCOUNT') {
        return Promise.reject(new Error('User declined the request'));
      }
      return Promise.resolve([]);
    });
    Object.defineProperty(window, 'qortalRequest', {
      configurable: true,
      writable: true,
      value: bridge,
    });

    const user = userEvent.setup();
    renderApp({ route: '/studio', environment: HOSTED, archiveLoader });
    await screen.findByRole('heading', { level: 1, name: 'Owner studio' });
    await user.click(screen.getByRole('button', { name: 'Enter owner mode' }));

    await screen.findByText('Account access was declined');
    expect(navLabels()).not.toContain('Studio');
  });
});

describe('SiteNav — verified owner', () => {
  it('appends Studio as the last item, after Contact', async () => {
    installBridge();
    await runOwnerFlow();

    expect(navLabels()).toEqual([
      'Home',
      'Blog',
      'Videos',
      'Gallery',
      'About',
      'Contact',
      'Studio',
    ]);
  });

  it('removes Studio again when the owner session is reset', async () => {
    installBridge();
    const user = userEvent.setup();
    await runOwnerFlow();

    expect(navLabels()).toContain('Studio');

    await user.click(screen.getByRole('button', { name: 'Sign out of owner mode' }));

    expect(navLabels()).not.toContain('Studio');
    expect(navLabels()).toHaveLength(6);
  });

  it('links Studio to the owner route', async () => {
    installBridge();
    await runOwnerFlow();

    expect(screen.getByRole('link', { name: 'Studio' })).toHaveAttribute('href', '/studio');
  });
});
