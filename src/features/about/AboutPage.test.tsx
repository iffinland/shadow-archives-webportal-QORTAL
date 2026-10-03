import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';

import { resetAuthSession } from '../../qortal/auth';
import { resetContentCache } from '../../services/cache';
import type { ArchiveSnapshot } from '../../services';
import { makeEnvironment } from '../../test/environment';
import { makeArchiveSnapshot } from '../../test/fixtures/content';
import { makeSearchHit } from '../../test/fixtures/qdn';
import { renderApp } from '../../test/utils';

const OWNER = 'QPw4vnk5CBDWkgdXB4vUXCc4DXGEjHVxCA';
const PUBLISHER = 'Shadow Archives';

const HOSTED = makeEnvironment({
  bridgeAvailable: true,
  isHosted: true,
  context: 'app',
  service: 'APP',
  name: 'Shadow%20Archives',
  publisherName: PUBLISHER,
});

const EMPTY_ARCHIVE: ArchiveSnapshot = makeArchiveSnapshot({ status: 'empty', source: 'none' });
const archiveLoader = async () => EMPTY_ARCHIVE;

function aboutPayload(text: string) {
  return {
    schemaVersion: 1,
    kind: 'about-page',
    publisher: PUBLISHER,
    updatedAt: 1_700_000_000_000,
    data: {
      body: {
        format: 'tiptap-json-v1',
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        },
      },
      bodyText: text,
    },
  };
}

/** Owner-capable bridge. `about` is the served payload; null means no resource. */
function installBridge(about: unknown | null) {
  const mock = vi.fn((payload: Record<string, unknown>) => {
    switch (payload.action) {
      case 'GET_USER_ACCOUNT':
        return Promise.resolve({ address: OWNER, publicKey: 'K' });
      case 'GET_ACCOUNT_NAMES':
        return Promise.resolve([{ name: PUBLISHER, owner: OWNER }]);
      case 'GET_NAME_DATA':
        return Promise.resolve({ name: PUBLISHER, owner: OWNER });
      case 'SEARCH_QDN_RESOURCES':
        return Promise.resolve(
          about === null ? [] : [makeSearchHit('DOCUMENT', PUBLISHER, 'saw_about')],
        );
      case 'FETCH_QDN_RESOURCE':
        return Promise.resolve(about);
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

afterEach(() => {
  resetAuthSession();
  resetContentCache();
  Reflect.deleteProperty(window, 'qortalRequest');
});

describe('AboutPage', () => {
  it('shows the built-in text and no owner control to a visitor', async () => {
    renderApp({ route: '/about' });

    expect(
      await screen.findByRole('heading', { level: 1, name: 'About Shadow Archives' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Where the content lives' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit About page' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Owner About-page controls')).not.toBeInTheDocument();
  });

  it('offers the owner control once owner capability is verified', async () => {
    installBridge(null);
    renderApp({ route: '/about', environment: HOSTED, archiveLoader });

    expect(await screen.findByRole('button', { name: 'Edit About page' })).toBeInTheDocument();
    // With no stored resource the built-in text is still what visitors read.
    expect(
      screen.getByRole('heading', { level: 2, name: 'Where the content lives' }),
    ).toBeInTheDocument();
  });

  it('renders the owner-published document instead of the built-in text', async () => {
    installBridge(aboutPayload('Owner-authored About body.'));
    renderApp({ route: '/about', environment: HOSTED, archiveLoader });

    expect(await screen.findByText('Owner-authored About body.')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByRole('heading', { level: 2, name: 'Where the content lives' }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: 'Edit About page' })).toBeInTheDocument();
  });

  it('never exposes owner controls to a verified non-owner', async () => {
    const mock = vi.fn((payload: Record<string, unknown>) => {
      switch (payload.action) {
        case 'GET_USER_ACCOUNT':
          return Promise.resolve({
            address: 'QNonOwnerAddressForTests00000000000',
            publicKey: 'K',
          });
        case 'GET_ACCOUNT_NAMES':
          return Promise.resolve([
            { name: 'Someone Else', owner: 'QNonOwnerAddressForTests00000000000' },
          ]);
        case 'GET_NAME_DATA':
          return Promise.resolve({ name: PUBLISHER, owner: OWNER });
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

    renderApp({ route: '/about', environment: HOSTED, archiveLoader });

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Where the content lives' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit About page' })).not.toBeInTheDocument();
  });
});
