import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from '../../test/utils';
import { makeEnvironment } from '../../test/environment';
import { resetAuthSession } from '../../qortal/auth';

const OWNER = 'QPw4vnk5CBDWkgdXB4vUXCc4DXGEjHVxCA';
const OTHER = 'QOtherAccountAddressForTests1234567890';

const hostedEnvironment = makeEnvironment({
  bridgeAvailable: true,
  isHosted: true,
  context: 'app',
  service: 'APP',
  name: 'Shadow%20Archives',
  publisherName: 'Shadow Archives',
});

interface BridgeHandlers {
  readonly account?: () => unknown;
  readonly names?: (address: string) => unknown;
  readonly nameData?: (name: string) => unknown;
}

function installHostBridge(handlers: BridgeHandlers = {}) {
  const mock = vi.fn((payload: Record<string, unknown>) => {
    switch (payload.action) {
      case 'GET_USER_ACCOUNT':
        return handlers.account
          ? handlers.account()
          : Promise.resolve({ address: OWNER, publicKey: 'K' });
      case 'GET_ACCOUNT_NAMES':
        return handlers.names
          ? handlers.names(String(payload.address))
          : Promise.resolve([{ name: 'Shadow Archives', owner: OWNER }]);
      case 'GET_NAME_DATA':
        return handlers.nameData
          ? handlers.nameData(String(payload.name))
          : Promise.resolve({ name: 'Shadow Archives', owner: OWNER });
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

function accountCalls(bridge: ReturnType<typeof installHostBridge>) {
  return bridge.mock.calls.filter((call) => call[0].action === 'GET_USER_ACCOUNT');
}

beforeEach(() => {
  resetAuthSession();
});

afterEach(() => {
  resetAuthSession();
  Reflect.deleteProperty(window, 'qortalRequest');
});

async function openStudio() {
  const view = renderApp({ route: '/studio', environment: hostedEnvironment });
  await screen.findByRole('heading', { level: 1, name: 'Owner studio' });
  return view;
}

describe('StudioPage — permission-free by default', () => {
  it('issues no permission request on load (public archive reads are still allowed)', async () => {
    const bridge = installHostBridge();
    await openStudio();

    expect(accountCalls(bridge)).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Enter owner mode' })).toBeInTheDocument();
  });

  it('requests account permission exactly once from the explicit action', async () => {
    const bridge = installHostBridge();
    const user = userEvent.setup();
    await openStudio();

    await user.click(screen.getByRole('button', { name: 'Enter owner mode' }));

    expect(await screen.findByText('Owner capability verified')).toBeInTheDocument();
    expect(accountCalls(bridge)).toHaveLength(1);
    expect(accountCalls(bridge)[0][0]).toEqual({ action: 'GET_USER_ACCOUNT' });
  });

  it('does not offer a second permission trigger while a request is pending', async () => {
    let resolveAccount: ((value: unknown) => void) | undefined;
    const bridge = installHostBridge({
      account: () =>
        new Promise((resolve) => {
          resolveAccount = resolve;
        }),
    });
    const user = userEvent.setup();
    await openStudio();

    await user.click(screen.getByRole('button', { name: 'Enter owner mode' }));

    expect(screen.getByText('Waiting for the Qortal host')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enter owner mode' })).not.toBeInTheDocument();
    expect(accountCalls(bridge)).toHaveLength(1);

    resolveAccount?.({ address: OWNER, publicKey: 'K' });
    expect(await screen.findByText('Owner capability verified')).toBeInTheDocument();
    expect(accountCalls(bridge)).toHaveLength(1);
  });

  it('returns to a usable read-only state when the user cancels', async () => {
    const bridge = installHostBridge({
      account: () => new Promise(() => {}),
    });
    const user = userEvent.setup();
    await openStudio();

    await user.click(screen.getByRole('button', { name: 'Enter owner mode' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.getByRole('button', { name: 'Enter owner mode' })).toBeInTheDocument();
    expect(accountCalls(bridge)).toHaveLength(1);
  });
});

describe('StudioPage — rejection and error states', () => {
  it('does not auto-retry a declined permission but allows an explicit retry', async () => {
    let attempt = 0;
    const bridge = installHostBridge({
      account: () => {
        attempt += 1;
        return attempt === 1
          ? Promise.reject(new Error('user declined request'))
          : Promise.resolve({ address: OWNER, publicKey: 'K' });
      },
    });
    const user = userEvent.setup();
    await openStudio();

    await user.click(screen.getByRole('button', { name: 'Enter owner mode' }));
    expect(await screen.findByText('Account access was declined')).toBeInTheDocument();

    // Give any accidental automatic retry a chance to fire.
    await waitFor(() => expect(accountCalls(bridge)).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Owner capability verified')).toBeInTheDocument();
    expect(accountCalls(bridge)).toHaveLength(2);
  });

  it('reports a host failure as an error, never as a non-owner decision', async () => {
    installHostBridge({ account: () => Promise.reject(new Error('host unreachable')) });
    const user = userEvent.setup();
    await openStudio();

    await user.click(screen.getByRole('button', { name: 'Enter owner mode' }));

    expect(await screen.findByText('Account access is unavailable')).toBeInTheDocument();
    expect(screen.queryByText(/not the owner/i)).not.toBeInTheDocument();
  });
});

describe('StudioPage — capability outcomes', () => {
  it('reports authenticated-non-owner truthfully with no owner controls', async () => {
    installHostBridge({
      account: () => Promise.resolve({ address: OTHER, publicKey: 'K' }),
      nameData: () => Promise.resolve({ name: 'Shadow Archives', owner: OWNER }),
    });
    const user = userEvent.setup();
    await openStudio();

    await user.click(screen.getByRole('button', { name: 'Enter owner mode' }));

    expect(await screen.findByText('Signed in — not the owner')).toBeInTheDocument();
    expect(screen.queryByText('Owner capability verified')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /publish|upload|new post/i }),
    ).not.toBeInTheDocument();
  });

  it('reports authenticated-no-name for an account with no registered names', async () => {
    installHostBridge({
      account: () => Promise.resolve({ address: OTHER, publicKey: 'K' }),
      names: () => Promise.resolve([]),
      nameData: () => Promise.resolve({ name: 'Shadow Archives', owner: OWNER }),
    });
    const user = userEvent.setup();
    await openStudio();

    await user.click(screen.getByRole('button', { name: 'Enter owner mode' }));

    expect(await screen.findByText('No registered Qortal name')).toBeInTheDocument();
  });

  it('cannot become owner when _qdnName is missing', async () => {
    installHostBridge();
    const view = renderApp({
      route: '/studio',
      environment: makeEnvironment({
        bridgeAvailable: true,
        isHosted: true,
        context: 'app',
        service: 'APP',
        name: null,
        publisherName: null,
      }),
    });
    const user = userEvent.setup();
    await screen.findByRole('heading', { level: 1, name: 'Owner studio' });

    await user.click(screen.getByRole('button', { name: 'Enter owner mode' }));

    expect(await screen.findByText('Could not verify ownership')).toBeInTheDocument();
    expect(screen.queryByText('Owner capability verified')).not.toBeInTheDocument();
    void view;
  });

  it('fails closed on malformed host responses', async () => {
    installHostBridge({
      names: () => Promise.resolve({ not: 'an array' }),
      nameData: () => Promise.resolve({ name: 'Shadow Archives' }),
    });
    const user = userEvent.setup();
    await openStudio();

    await user.click(screen.getByRole('button', { name: 'Enter owner mode' }));

    expect(await screen.findByText('Could not verify ownership')).toBeInTheDocument();
    expect(screen.queryByText('Owner capability verified')).not.toBeInTheDocument();
  });

  it('re-resolves ownership so a transferred publishing name revokes owner capability', async () => {
    let currentOwner = OWNER;
    installHostBridge({
      names: () => Promise.resolve([{ name: 'Shadow Archives', owner: currentOwner }]),
      nameData: () => Promise.resolve({ name: 'Shadow Archives', owner: currentOwner }),
    });
    const user = userEvent.setup();
    await openStudio();

    await user.click(screen.getByRole('button', { name: 'Enter owner mode' }));
    expect(await screen.findByText('Owner capability verified')).toBeInTheDocument();

    // The publishing name is transferred to a different account.
    currentOwner = OTHER;
    await user.click(screen.getByRole('button', { name: 'Re-check ownership' }));

    expect(await screen.findByText('Signed in — not the owner')).toBeInTheDocument();
    expect(screen.queryByText('Owner capability verified')).not.toBeInTheDocument();
  });

  it('exposes an owner status shell without any publish control', async () => {
    installHostBridge();
    const user = userEvent.setup();
    await openStudio();

    await user.click(screen.getByRole('button', { name: 'Enter owner mode' }));
    await screen.findByText('Owner capability verified');

    const panel = screen.getByLabelText('Owner studio status');
    expect(within(panel).getByText('Shadow Archives')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out of owner mode' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /publish|upload|new post|edit/i }),
    ).not.toBeInTheDocument();
  });
});

describe('StudioPage — development contexts', () => {
  it('shows a dev/identity-not-authoritative notice in the proxy context', async () => {
    const bridge = installHostBridge();
    renderApp({
      route: '/studio',
      environment: makeEnvironment({
        bridgeAvailable: true,
        isHosted: true,
        context: 'proxy',
        isProxy: true,
        service: 'APP',
        name: null,
        publisherName: null,
      }),
    });
    await screen.findByRole('heading', { level: 1, name: 'Owner studio' });

    expect(screen.getByText('Development — identity not authoritative')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enter owner mode' })).not.toBeInTheDocument();
    expect(bridge).not.toHaveBeenCalled();
  });

  it('explains a plain browser with no Qortal bridge', async () => {
    renderApp({ route: '/studio', environment: makeEnvironment() });
    await screen.findByRole('heading', { level: 1, name: 'Owner studio' });

    expect(screen.getByText('Not running in a Qortal host')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enter owner mode' })).not.toBeInTheDocument();
  });
});
