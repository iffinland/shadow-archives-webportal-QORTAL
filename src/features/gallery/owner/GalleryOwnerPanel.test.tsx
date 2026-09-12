import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from '../../../test/utils';
import { makeEnvironment } from '../../../test/environment';
import { resetAuthSession } from '../../../qortal/auth';
import type { ArchiveSnapshot } from '../../../services';

// The owner → gallery → publish flows mount several lazy chunks and wait on the
// real bridge wrapper, which is slower than the 5s default under parallel load.
vi.setConfig({ testTimeout: 20_000 });

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

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

function imageFile(): File {
  return new File([PNG], 'harbour.png', { type: 'image/png' });
}

interface BridgeOptions {
  readonly publishMultiple?: () => Promise<unknown>;
}

function installBridge(options: BridgeOptions = {}) {
  const mock = vi.fn((payload: Record<string, unknown>) => {
    switch (payload.action) {
      case 'GET_USER_ACCOUNT':
        return Promise.resolve({ address: OWNER, publicKey: 'K' });
      case 'GET_ACCOUNT_NAMES':
        return Promise.resolve([{ name: PUBLISHER, owner: OWNER }]);
      case 'GET_NAME_DATA':
        return Promise.resolve({ name: PUBLISHER, owner: OWNER });
      case 'SEARCH_QDN_RESOURCES':
        return Promise.resolve([]);
      case 'PUBLISH_QDN_RESOURCE':
        return Promise.resolve({ signature: 'entity-signature' });
      case 'PUBLISH_MULTIPLE_QDN_RESOURCES':
        return options.publishMultiple
          ? options.publishMultiple()
          : Promise.resolve({ signature: 'group-signature' });
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

function publishCalls(bridge: ReturnType<typeof installBridge>) {
  return bridge.mock.calls.filter((call) => String(call[0].action).startsWith('PUBLISH_'));
}

function accountCalls(bridge: ReturnType<typeof installBridge>) {
  return bridge.mock.calls.filter((call) => call[0].action === 'GET_USER_ACCOUNT');
}

/* Browser image APIs jsdom does not implement; the real pipeline must run. */
const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalToBlob = HTMLCanvasElement.prototype.toBlob;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
let originalCreateImageBitmap: typeof globalThis.createImageBitmap | undefined;

function installBrowserImageSupport() {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(() => 'blob:preview'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  originalCreateImageBitmap = globalThis.createImageBitmap;
  Object.defineProperty(globalThis, 'createImageBitmap', {
    configurable: true,
    writable: true,
    value: vi.fn(async () => ({ width: 1600, height: 900, close: () => undefined })),
  });
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
    clearRect: () => undefined,
    drawImage: () => undefined,
  })) as unknown as HTMLCanvasElement['getContext'];
  HTMLCanvasElement.prototype.toBlob = function toBlob(callback, type) {
    callback(new Blob([new Uint8Array(1024)], { type: type ?? 'image/webp' }));
  } as HTMLCanvasElement['toBlob'];
}

function restoreBrowserImageSupport() {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  HTMLCanvasElement.prototype.toBlob = originalToBlob;
  // jsdom implements neither method; leave a callable no-op so React's passive
  // unmount cleanup (which runs after this hook) can still revoke the preview.
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: originalCreateObjectURL ?? (() => 'blob:preview'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: originalRevokeObjectURL ?? (() => undefined),
  });
  if (originalCreateImageBitmap === undefined) {
    Reflect.deleteProperty(globalThis, 'createImageBitmap');
  } else {
    Object.defineProperty(globalThis, 'createImageBitmap', {
      configurable: true,
      writable: true,
      value: originalCreateImageBitmap,
    });
  }
}

async function openGalleryAsOwner(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup({ applyAccept: false });
  renderApp({ route: '/studio', environment: HOSTED, archiveLoader });
  await screen.findByRole('heading', { level: 1, name: 'Owner studio' });
  await user.click(screen.getByRole('button', { name: 'Enter owner mode' }));
  await screen.findByText('Owner capability verified');
  await user.click(screen.getByRole('link', { name: 'Manage Gallery' }));
  await screen.findByRole('heading', { level: 1, name: 'Gallery' });
  await screen.findByRole('button', { name: 'Add image' });
  return user;
}

beforeEach(() => {
  resetAuthSession();
  installBrowserImageSupport();
});

afterEach(() => {
  resetAuthSession();
  restoreBrowserImageSupport();
  Reflect.deleteProperty(window, 'qortalRequest');
});

describe('Gallery visitor view', () => {
  it('stays read-only and renders no owner controls or auth request', async () => {
    const bridge = installBridge();
    renderApp({ route: '/gallery', environment: HOSTED, archiveLoader });

    await screen.findByRole('heading', { level: 1, name: 'Gallery' });

    expect(screen.queryByRole('button', { name: 'Add image' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create album' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Owner gallery controls')).not.toBeInTheDocument();
    expect(accountCalls(bridge)).toHaveLength(0);
    expect(publishCalls(bridge)).toHaveLength(0);
  });
});

describe('Gallery owner controls', () => {
  it('shows Add image and Create album only for a verified owner', async () => {
    installBridge();
    await openGalleryAsOwner();

    const panel = screen.getByLabelText('Owner gallery controls');
    expect(within(panel).getByRole('button', { name: 'Add image' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Create album' })).toBeInTheDocument();
  });

  it('performs no write when the album dialog is cancelled', async () => {
    const bridge = installBridge();
    const user = await openGalleryAsOwner();

    await user.click(screen.getByRole('button', { name: 'Create album' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(publishCalls(bridge)).toHaveLength(0);
  });

  it('opens an accessible dialog that Escape can dismiss', async () => {
    installBridge();
    const user = await openGalleryAsOwner();

    await user.click(screen.getByRole('button', { name: 'Add image' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Add gallery image');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('only publishes after the owner explicitly confirms, never on dialog open', async () => {
    const bridge = installBridge();
    const user = await openGalleryAsOwner();

    await user.click(screen.getByRole('button', { name: 'Add image' }));
    const dialog = await screen.findByRole('dialog');

    await user.upload(within(dialog).getByLabelText(/Image file/), imageFile());
    await user.type(within(dialog).getByLabelText('Title'), 'Harbour at dusk');

    expect(publishCalls(bridge)).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Publish' }));

    await screen.findByText(/^Published\./);

    const actions = publishCalls(bridge).map((call) => String(call[0].action));
    expect(actions).toContain('PUBLISH_MULTIPLE_QDN_RESOURCES');
    expect(actions).toContain('PUBLISH_QDN_RESOURCE');
    // media + thumbnail first, then the entity, then the catalog pair.
    expect(actions).toEqual([
      'PUBLISH_MULTIPLE_QDN_RESOURCES',
      'PUBLISH_QDN_RESOURCE',
      'PUBLISH_MULTIPLE_QDN_RESOURCES',
    ]);
  });

  it('treats an ambiguous publish timeout as uncertain and offers Verify, not an automatic retry', async () => {
    const bridge = installBridge({
      publishMultiple: () =>
        Promise.reject(new Error('Request timed out: PUBLISH_MULTIPLE_QDN_RESOURCES')),
    });
    const user = await openGalleryAsOwner();

    await user.click(screen.getByRole('button', { name: 'Add image' }));
    const dialog = await screen.findByRole('dialog');
    await user.upload(within(dialog).getByLabelText(/Image file/), imageFile());
    await user.type(within(dialog).getByLabelText('Title'), 'Uncertain upload');
    await user.click(within(dialog).getByRole('button', { name: 'Publish' }));

    await screen.findByText(/nothing was retried automatically/);

    // Exactly one media submission attempt: no optimistic retry.
    const mediaAttempts = publishCalls(bridge).filter(
      (call) => call[0].action === 'PUBLISH_MULTIPLE_QDN_RESOURCES',
    );
    expect(mediaAttempts).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Verify' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Publish again' })).not.toBeInTheDocument();
  });

  it('rejects an unsupported file before offering to publish', async () => {
    const bridge = installBridge();
    const user = await openGalleryAsOwner();

    await user.click(screen.getByRole('button', { name: 'Add image' }));
    const dialog = await screen.findByRole('dialog');
    await user.upload(
      within(dialog).getByLabelText(/Image file/),
      new File(['not an image'], 'notes.txt', { type: 'text/plain' }),
    );

    await screen.findByText(/Only JPEG, PNG and WebP/);
    expect(publishCalls(bridge)).toHaveLength(0);
  });
});
