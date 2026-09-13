import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderApp } from '../../../test/utils';
import { makeEnvironment } from '../../../test/environment';
import { resetAuthSession } from '../../../qortal/auth';
import { browserVideoProbeDeps, type VideoElementLike } from '../../../services/videoMetadataProbe';
import type { ArchiveSnapshot } from '../../../services';

// The owner → videos → publish flows mount several lazy chunks and drive the real
// bridge wrapper, which is slower than the 5s default under parallel load.
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

function posterFile(): File {
  return new File([PNG], 'harbour.png', { type: 'image/png' });
}

function videoFile(): File {
  return new File([new Uint8Array(4096)], 'harbour-clip.mp4', { type: 'video/mp4' });
}

function installBridge() {
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
        return Promise.resolve({ signature: 'group-signature' });
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

/*
 * jsdom never fires media events, so the real bounded probe would always time
 * out (and take 20s). Replace only the element factory of the probe's browser
 * dependency object; the probe logic under test is unchanged.
 */
const originalProbeCreateVideo = browserVideoProbeDeps.createVideo;

function installVideoProbe(durationSeconds = 42, width = 1920, height = 1080) {
  browserVideoProbeDeps.createVideo = (): VideoElementLike => {
    const listeners = new Map<string, Set<() => void>>();
    const element: VideoElementLike = {
      src: '',
      preload: '',
      muted: false,
      duration: durationSeconds,
      videoWidth: width,
      videoHeight: height,
      addEventListener(type, listener) {
        const set = listeners.get(type) ?? new Set();
        set.add(listener);
        listeners.set(type, set);
      },
      removeEventListener(type, listener) {
        listeners.get(type)?.delete(listener);
      },
      removeAttribute() {
        // Detaching is a no-op for the fake.
      },
      load() {
        for (const listener of [...(listeners.get('loadedmetadata') ?? [])]) listener();
      },
    };
    return element;
  };
}

function restoreVideoProbe() {
  browserVideoProbeDeps.createVideo = originalProbeCreateVideo;
}

async function openVideosAsOwner(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup({ applyAccept: false });
  renderApp({ route: '/studio', environment: HOSTED, archiveLoader });
  await screen.findByRole('heading', { level: 1, name: 'Owner studio' });
  await user.click(screen.getByRole('button', { name: 'Enter owner mode' }));
  await screen.findByText('Owner capability verified');
  await user.click(screen.getByRole('link', { name: 'Manage Videos' }));
  await screen.findByRole('heading', { level: 1, name: 'Videos' });
  await screen.findByRole('button', { name: 'Add video' });
  return user;
}

beforeEach(() => {
  resetAuthSession();
  installBrowserImageSupport();
  installVideoProbe();
});

afterEach(() => {
  resetAuthSession();
  restoreBrowserImageSupport();
  restoreVideoProbe();
  Reflect.deleteProperty(window, 'qortalRequest');
});

describe('Videos visitor view', () => {
  it('stays read-only and renders no owner controls or auth request', async () => {
    const bridge = installBridge();
    renderApp({ route: '/videos', environment: HOSTED, archiveLoader });

    await screen.findByRole('heading', { level: 1, name: 'Videos' });

    expect(screen.queryByRole('button', { name: 'Add video' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Owner video controls')).not.toBeInTheDocument();
    expect(accountCalls(bridge)).toHaveLength(0);
    expect(publishCalls(bridge)).toHaveLength(0);
  });
});

describe('Video owner controls', () => {
  it('shows Add video only for a verified owner', async () => {
    installBridge();
    await openVideosAsOwner();

    const panel = screen.getByLabelText('Owner video controls');
    expect(within(panel).getByRole('button', { name: 'Add video' })).toBeInTheDocument();
  });

  it('opens an accessible dialog that Escape can dismiss without a write', async () => {
    const bridge = installBridge();
    const user = await openVideosAsOwner();

    await user.click(screen.getByRole('button', { name: 'Add video' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Add video');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(publishCalls(bridge)).toHaveLength(0);
  });

  it('performs no write when the dialog is cancelled', async () => {
    const bridge = installBridge();
    const user = await openVideosAsOwner();

    await user.click(screen.getByRole('button', { name: 'Add video' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(publishCalls(bridge)).toHaveLength(0);
  });

  it('validates the form before any write when the video is missing', async () => {
    const bridge = installBridge();
    const user = await openVideosAsOwner();

    await user.click(screen.getByRole('button', { name: 'Add video' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Publish' }));

    await screen.findByText(/Choose a video file/i);
    expect(publishCalls(bridge)).toHaveLength(0);
  });

  it('publishes media+poster, metadata and the index only after explicit confirmation', async () => {
    const bridge = installBridge();
    const user = await openVideosAsOwner();

    await user.click(screen.getByRole('button', { name: 'Add video' }));
    const dialog = await screen.findByRole('dialog');

    await user.upload(within(dialog).getByLabelText(/Video file/), videoFile());
    // The injected probe reports the duration automatically.
    await waitFor(() => expect(within(dialog).getByLabelText(/Duration/)).toHaveValue(42));
    await user.upload(within(dialog).getByLabelText(/Poster image/), posterFile());
    await user.type(within(dialog).getByLabelText('Title'), 'Harbour at dusk');
    await user.type(within(dialog).getByLabelText('Description'), 'A wide shot from the pier.');

    expect(publishCalls(bridge)).toHaveLength(0);

    await user.click(within(dialog).getByRole('button', { name: 'Publish' }));

    await screen.findByText(/^Published\./);

    const actions = publishCalls(bridge).map((call) => String(call[0].action));
    // media + poster first, then entity + Q-Tube metadata, then the catalog pair.
    expect(actions).toEqual([
      'PUBLISH_MULTIPLE_QDN_RESOURCES',
      'PUBLISH_MULTIPLE_QDN_RESOURCES',
      'PUBLISH_MULTIPLE_QDN_RESOURCES',
    ]);

    const firstPayload = (
      publishCalls(bridge)[0][0] as {
        resources: { service: string; identifier: string; file?: unknown }[];
      }
    ).resources;
    expect(firstPayload[0].service).toBe('VIDEO');
    expect(firstPayload[0].identifier).toMatch(/^qtube_vid_[0-9a-z]{12}$/);
    expect(firstPayload[0].file).toBeTruthy();
    expect(firstPayload[1].service).toBe('THUMBNAIL');
    expect(firstPayload[1].identifier).toMatch(/^saw_vid_thumb_[0-9a-z]{12}$/);

    const secondPayload = (
      publishCalls(bridge)[1][0] as {
        resources: { service: string; identifier: string }[];
      }
    ).resources;
    expect(secondPayload[0].identifier).toMatch(/^saw_vid_[0-9a-z]{12}$/);
    expect(secondPayload[1].identifier).toMatch(/^qtube_vid_[0-9a-z]{12}_metadata$/);
  });

  it('rejects an unsupported video container before offering to publish', async () => {
    const bridge = installBridge();
    const user = await openVideosAsOwner();

    await user.click(screen.getByRole('button', { name: 'Add video' }));
    const dialog = await screen.findByRole('dialog');
    await user.upload(
      within(dialog).getByLabelText(/Video file/),
      new File([new Uint8Array(4096)], 'movie.mkv', { type: 'video/x-matroska' }),
    );

    await screen.findByText(/not supported/i);
    expect(publishCalls(bridge)).toHaveLength(0);
  });
});
