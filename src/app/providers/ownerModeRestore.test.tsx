import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from '../../test/utils';
import { makeEnvironment } from '../../test/environment';
import { resetAuthSession } from '../../qortal/auth';
import { OWNER_MODE_STORAGE_KEY, OWNER_MODE_STORAGE_VALUE } from '../../qortal/ownerModeSession';
import type { ArchiveSnapshot } from '../../services';

// Restoration mounts several lazy chunks and waits on the real bridge wrapper.
vi.setConfig({ testTimeout: 20_000 });

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

/* Mutable bridge state so a test can change the live host between mounts. */
let accountAddress = OWNER;
let accountRejection: string | null = null;
let nameOwner = OWNER;
let deferNameData: (() => Promise<unknown>) | null = null;
let deferredNameData: { resolve: (value: unknown) => void } | null = null;

function resetBridgeState(): void {
  accountAddress = OWNER;
  accountRejection = null;
  nameOwner = OWNER;
  deferNameData = null;
  deferredNameData = null;
}

function installBridge() {
  const mock = vi.fn((payload: Record<string, unknown>) => {
    switch (payload.action) {
      case 'GET_USER_ACCOUNT':
        return accountRejection
          ? Promise.reject(new Error(accountRejection))
          : Promise.resolve({ address: accountAddress, publicKey: 'K' });
      case 'GET_ACCOUNT_NAMES':
        return Promise.resolve([{ name: PUBLISHER, owner: accountAddress }]);
      case 'GET_NAME_DATA':
        return deferNameData
          ? deferNameData()
          : Promise.resolve({ name: PUBLISHER, owner: nameOwner });
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

function callsFor(bridge: ReturnType<typeof installBridge>, action: string) {
  return bridge.mock.calls.filter((call) => call[0].action === action);
}

function marker(): string | null {
  return window.sessionStorage.getItem(OWNER_MODE_STORAGE_KEY);
}

function setMarker(): void {
  window.sessionStorage.setItem(OWNER_MODE_STORAGE_KEY, OWNER_MODE_STORAGE_VALUE);
}

function navLabels(): string[] {
  const nav = screen.getByRole('navigation', { name: 'Site sections' });
  return within(nav)
    .getAllByRole('link')
    .map((link) => (link.textContent ?? '').trim());
}

async function enterOwnerMode(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await screen.findByRole('heading', { level: 1, name: 'Owner studio' });
  await user.click(screen.getByRole('button', { name: 'Enter owner mode' }));
  await screen.findByText('Owner capability verified');
}

/**
 * Model a real document reload: the mounted app is torn down completely and the
 * module-level auth cache is dropped, exactly as a fresh document would be,
 * while `sessionStorage` (tab-scoped) survives untouched.
 */
function unmountForReload(view: ReturnType<typeof renderApp>): void {
  view.unmount();
  resetAuthSession();
}

function mountHosted(route: string) {
  return renderApp({ route, environment: HOSTED, archiveLoader });
}

beforeEach(() => {
  resetAuthSession();
  resetBridgeState();
});

afterEach(() => {
  resetAuthSession();
  resetBridgeState();
  Reflect.deleteProperty(window, 'qortalRequest');
});

describe('owner mode across a real document reload', () => {
  it('restores owner capability on a fresh AppProviders mount and shows owner controls', async () => {
    const bridge = installBridge();
    const user = userEvent.setup();

    const first = mountHosted('/studio');
    await enterOwnerMode(user);

    expect(marker()).toBe(OWNER_MODE_STORAGE_VALUE);
    expect(callsFor(bridge, 'GET_USER_ACCOUNT')).toHaveLength(1);

    unmountForReload(first);

    mountHosted('/gallery');
    await screen.findByRole('heading', { level: 1, name: 'Gallery' });

    // Revalidation happened against the live host, not from persisted authority.
    await screen.findByLabelText('Owner gallery controls');
    expect(callsFor(bridge, 'GET_USER_ACCOUNT')).toHaveLength(2);
    expect(callsFor(bridge, 'GET_NAME_DATA')).toHaveLength(2);

    expect(screen.getByRole('link', { name: 'Studio' })).toBeInTheDocument();
    expect(navLabels()).toContain('Studio');
    expect(screen.getByRole('button', { name: 'Add image' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create album' })).toBeInTheDocument();
  });

  it('does not expose owner controls before restoration finishes verifying', async () => {
    const bridge = installBridge();
    const user = userEvent.setup();

    const first = mountHosted('/studio');
    await enterOwnerMode(user);
    unmountForReload(first);

    // Hold the ownership lookup open so the resolving window is observable.
    deferNameData = () =>
      new Promise<unknown>((resolve) => {
        deferredNameData = { resolve };
      });

    mountHosted('/gallery');
    await screen.findByRole('heading', { level: 1, name: 'Gallery' });

    expect(screen.queryByLabelText('Owner gallery controls')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add image' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Studio' })).not.toBeInTheDocument();

    deferredNameData?.resolve({ name: PUBLISHER, owner: OWNER });

    await screen.findByLabelText('Owner gallery controls');
    expect(screen.getByRole('link', { name: 'Studio' })).toBeInTheDocument();
    expect(callsFor(bridge, 'GET_NAME_DATA')).toHaveLength(2);
  });

  it('fails closed when the publishing name was transferred while the marker survived', async () => {
    const bridge = installBridge();
    const user = userEvent.setup();

    const first = mountHosted('/studio');
    await enterOwnerMode(user);
    expect(marker()).toBe(OWNER_MODE_STORAGE_VALUE);

    unmountForReload(first);
    // The connected account is unchanged, but the name now belongs to someone else.
    nameOwner = OTHER;

    mountHosted('/gallery');
    await screen.findByRole('heading', { level: 1, name: 'Gallery' });

    await waitFor(() => expect(callsFor(bridge, 'GET_NAME_DATA')).toHaveLength(2));
    expect(screen.queryByLabelText('Owner gallery controls')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add image' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Studio' })).not.toBeInTheDocument();
    expect(marker()).toBeNull();
  });

  it('clears the marker when the owner signs out', async () => {
    installBridge();
    const user = userEvent.setup();

    mountHosted('/studio');
    await enterOwnerMode(user);
    expect(marker()).toBe(OWNER_MODE_STORAGE_VALUE);

    await user.click(screen.getByRole('button', { name: 'Sign out of owner mode' }));

    await waitFor(() => expect(marker()).toBeNull());
    expect(screen.queryByRole('link', { name: 'Studio' })).not.toBeInTheDocument();
  });

  it('clears the marker and does not retry after a rejected restore', async () => {
    const bridge = installBridge();
    setMarker();
    accountRejection = 'User declined the request';

    mountHosted('/studio');
    await screen.findByText('Account access was declined');

    expect(marker()).toBeNull();
    expect(callsFor(bridge, 'GET_USER_ACCOUNT')).toHaveLength(1);
    expect(callsFor(bridge, 'GET_ACCOUNT_NAMES')).toHaveLength(0);

    // No automatic retry loop: the count must stay at one.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(callsFor(bridge, 'GET_USER_ACCOUNT')).toHaveLength(1);
  });
});

describe('owner mode restoration gating', () => {
  it('issues no account request when no marker is present', async () => {
    const bridge = installBridge();

    mountHosted('/gallery');
    await screen.findByRole('heading', { level: 1, name: 'Gallery' });

    expect(marker()).toBeNull();
    expect(callsFor(bridge, 'GET_USER_ACCOUNT')).toHaveLength(0);
  });

  it('does not restore outside a qortal-host runtime even with a marker', async () => {
    const bridge = installBridge();
    setMarker();

    renderApp({ route: '/', environment: makeEnvironment(), archiveLoader });
    await screen.findByRole('heading', { level: 1, name: 'Shadow Archives' });

    expect(callsFor(bridge, 'GET_USER_ACCOUNT')).toHaveLength(0);
  });
});
