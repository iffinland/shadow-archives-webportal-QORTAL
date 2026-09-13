import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AppProviders } from '../../../app/providers/AppProviders';
import { useAuth } from '../../../app/providers/AuthProvider';
import { makeEnvironment } from '../../../test/environment';
import { makeArchiveSnapshot } from '../../../test/fixtures/content';
import { resetAuthSession } from '../../../qortal/auth';
import type {
  PublishAttempt,
  PublishPort,
  PublishResourceInput,
  PublishSubmission,
} from '../../../qortal/publish';
import type { RichTextDocument } from '../../../domain/types';
import type { CachePutOptions, CacheRecord, ContentCache } from '../../../services/cache';
import type { ImageProcessingDeps } from '../../../services/imageProcessing';
import type { QdnReadPort } from '../../../services/qdnReader';
import { createBlogPublishDeps, type BlogPublishDeps } from '../../../services/blogPublishService';
import BlogOwnerPanel from './BlogOwnerPanel';
import { BlogPublishModal } from './BlogPublishModal';
import type { BlogEditorProps } from './BlogEditor';

const OWNER = 'QPw4vnk5CBDWkgdXB4vUXCc4DXGEjHVxCA';
const PUBLISHER = 'Shadow Archives';
const NOW = 1_700_000_000_000;

const HOSTED = makeEnvironment({
  bridgeAvailable: true,
  isHosted: true,
  context: 'app',
  service: 'APP',
  name: 'Shadow%20Archives',
  publisherName: PUBLISHER,
});

const BODY: RichTextDocument = {
  format: 'tiptap-json-v1',
  doc: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Body.' }] }],
  },
};

const PNG_HEADER = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);

/** The test seam that avoids mounting the real TipTap editor in jsdom. */
function fakeEditor({ onChange }: BlogEditorProps) {
  return (
    <button type="button" onClick={() => onChange(BODY)}>
      Write body
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Deterministic deps                                                         */
/* -------------------------------------------------------------------------- */

function readerWithNothing(): QdnReadPort {
  return {
    async search() {
      return [];
    },
    async fetchText() {
      throw new Error('no resources');
    },
  };
}

function memoryCache(): ContentCache {
  const store = new Map<string, CacheRecord<unknown>>();
  return {
    async get<T>(key: string) {
      return (store.get(key) as CacheRecord<T> | undefined) ?? null;
    },
    async put<T>(key: string, value: T, options: CachePutOptions) {
      store.set(key, { key, value, storedAt: NOW, expiresAt: NOW + options.ttlMs, version: 1 });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async clear() {
      store.clear();
    },
  };
}

function submissionFor(resource: PublishResourceInput, callIndex: number): PublishSubmission {
  return {
    service: resource.service,
    identifier: resource.identifier ?? null,
    name: resource.name,
    signature: `signature-${callIndex}`,
    raw: { signature: `signature-${callIndex}` },
  };
}

interface WriterFake {
  readonly port: PublishPort;
  readonly calls: readonly PublishResourceInput[][];
}

function writerFake(): WriterFake {
  const calls: PublishResourceInput[][] = [];
  const submitted = (
    resources: readonly PublishResourceInput[],
    index: number,
  ): PublishAttempt => ({
    kind: 'submitted',
    submissions: resources.map((resource) => submissionFor(resource, index)),
  });
  return {
    calls,
    port: {
      async publishResource(resource) {
        const index = calls.push([resource]);
        return submitted([resource], index);
      },
      async publishResources(resources) {
        const index = calls.push([...resources]);
        return submitted(resources, index);
      },
    },
  };
}

function fakeImageDeps(): ImageProcessingDeps {
  return {
    async decode() {
      return { width: 1200, height: 800, close: () => undefined };
    },
    createCanvas(width, height) {
      return {
        canvas: { width, height } as unknown as HTMLCanvasElement,
        context: {
          clearRect: () => undefined,
          drawImage: () => undefined,
        } as unknown as CanvasRenderingContext2D,
      };
    },
    async toBlob(canvas, type) {
      const target = canvas as unknown as { width: number };
      return new Blob([new Uint8Array(Math.max(64, Math.round(target.width / 4)))], { type });
    },
  };
}

function makeDeps(writer: WriterFake): BlogPublishDeps {
  return createBlogPublishDeps({
    reader: readerWithNothing(),
    writer: writer.port,
    cache: memoryCache(),
    now: () => NOW,
    imageDeps: fakeImageDeps(),
    checksumFn: async () => 'sha256:fixture',
  });
}

/* -------------------------------------------------------------------------- */
/* Bridge                                                                     */
/* -------------------------------------------------------------------------- */

function installHostBridge(): void {
  const mock = vi.fn(async (payload: Record<string, unknown>) => {
    switch (payload.action) {
      case 'GET_USER_ACCOUNT':
        return { address: OWNER, publicKey: 'K' };
      case 'GET_ACCOUNT_NAMES':
        return [{ name: PUBLISHER, owner: OWNER }];
      case 'GET_NAME_DATA':
        return { name: payload.name, owner: OWNER };
      default:
        throw new Error(`Unexpected bridge action: ${String(payload.action)}`);
    }
  });
  Object.defineProperty(window, 'qortalRequest', {
    configurable: true,
    writable: true,
    value: mock,
  });
}

/** Runs the explicit owner authentication the real UI triggers from Studio. */
function OwnerHarness({ deps }: { readonly deps: BlogPublishDeps }) {
  const { authenticate } = useAuth();
  useEffect(() => {
    void authenticate();
  }, [authenticate]);
  return <BlogPublishModal onClose={() => undefined} deps={deps} renderEditor={fakeEditor} />;
}

function renderModal(deps: BlogPublishDeps) {
  return render(
    <AppProviders
      environment={HOSTED}
      initialAccount={{ address: OWNER, publicKey: 'K' }}
      archiveLoader={async () => makeArchiveSnapshot()}
    >
      <OwnerHarness deps={deps} />
    </AppProviders>,
  );
}

/**
 * Submits the publish form.
 *
 * `fireEvent.submit` is used instead of a synthetic button click because jsdom's
 * implicit submission for a submit button inside a portalled form is not
 * reliable; the real browser behaviour is the native form submit the handler
 * already relies on.
 */
function submitPublishForm(): void {
  const form = document.querySelector('form.sa-form');
  if (!form) throw new Error('the publish form is not mounted');
  fireEvent.submit(form);
}

async function fillAndPublish(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Title'), 'Uncovering the past');
  await user.type(screen.getByLabelText('Excerpt / summary'), 'A short summary.');
  await user.click(screen.getByRole('button', { name: 'Write body' }));
  const cover = new File([PNG_HEADER], 'cover.png', { type: 'image/png' });
  await user.upload(screen.getByLabelText(/Cover image/), cover);
  submitPublishForm();
}

beforeEach(() => {
  resetAuthSession();
  // jsdom does not implement object URLs; the modal only uses them for a local
  // preview and never publishes through them.
  if (typeof URL.createObjectURL !== 'function') {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: () => 'blob:test' });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: () => undefined });
  }
});

afterEach(() => {
  resetAuthSession();
  Reflect.deleteProperty(window, 'qortalRequest');
});

/* -------------------------------------------------------------------------- */
/* Owner panel visibility                                                     */
/* -------------------------------------------------------------------------- */

describe('BlogOwnerPanel', () => {
  it('renders nothing without owner capability', async () => {
    const deps = makeDeps(writerFake());
    const view = render(
      <AppProviders environment={HOSTED} archiveLoader={async () => makeArchiveSnapshot()}>
        <BlogOwnerPanel deps={deps} renderEditor={fakeEditor} />
      </AppProviders>,
    );

    await waitFor(() => expect(view.container).toBeEmptyDOMElement());
    expect(screen.queryByRole('button', { name: 'Write a post' })).not.toBeInTheDocument();
  });
});

/* -------------------------------------------------------------------------- */
/* Publish workflow                                                           */
/* -------------------------------------------------------------------------- */

describe('BlogPublishModal — publish workflow', () => {
  it('validates required fields before any write', async () => {
    installHostBridge();
    const writer = writerFake();
    renderModal(makeDeps(writer));

    submitPublishForm();

    expect(await screen.findByRole('alert')).toHaveTextContent('A title is required.');
    expect(writer.calls).toHaveLength(0);
  });

  it('publishes the cover, entity+SubWire artifact and index, then shows the exact identities', async () => {
    installHostBridge();
    const writer = writerFake();
    const user = userEvent.setup();
    renderModal(makeDeps(writer));

    await fillAndPublish(user);

    expect(await screen.findByText(/Published\./)).toBeInTheDocument();
    expect(writer.calls).toHaveLength(3);

    const [cover] = writer.calls[0];
    const [entity, subwire] = writer.calls[1];
    expect(cover.service).toBe('THUMBNAIL');
    expect(entity.identifier).toMatch(/^saw_post_/);
    expect(subwire.identifier).toBe(await identifierOf(writer));
    // The exact SubWire-compatible coordinate is shown to the owner.
    expect(screen.getByText(subwire.identifier as string)).toBeInTheDocument();
    expect(screen.getByText(entity.identifier as string)).toBeInTheDocument();
  });

  it('does not post to Quitter unless the owner opts in and explicitly announces', async () => {
    installHostBridge();
    const writer = writerFake();
    const user = userEvent.setup();
    renderModal(makeDeps(writer));

    await fillAndPublish(user);

    expect(await screen.findByText(/Published\./)).toBeInTheDocument();
    // No Quitter step without the explicit opt-in, and no extra write.
    expect(screen.queryByRole('button', { name: /Post announcement to Quitter/ })).toBeNull();
    expect(writer.calls).toHaveLength(3);
  });

  it('offers the Quitter announcement as a separate owner-approved write', async () => {
    installHostBridge();
    const writer = writerFake();
    const user = userEvent.setup();
    renderModal(makeDeps(writer));

    fireEvent.click(screen.getByRole('checkbox', { name: /Also offer a Quitter announcement/ }));
    await fillAndPublish(user);
    expect(await screen.findByText(/Published\./)).toBeInTheDocument();
    // Opting in does not write to Quitter; only the three article resources exist.
    expect(writer.calls).toHaveLength(3);

    fireEvent.click(screen.getByRole('button', { name: 'Post announcement to Quitter' }));

    // The announcement is its own write with its own Quitter identifier.
    expect(await screen.findByText(/Quitter announced the submission/)).toBeInTheDocument();
    expect(writer.calls).toHaveLength(4);
    const quitterIdentifier = writer.calls[3][0].identifier as string;
    expect(quitterIdentifier).toMatch(/-[0-9a-z]{12}-v1$/);
    expect(screen.getByText(quitterIdentifier)).toBeInTheDocument();
  });
});

/** The SubWire coordinate derived from the id the modal minted for the entity. */
async function identifierOf(writer: WriterFake): Promise<string> {
  const entityIdentifier = writer.calls[1][0].identifier as string;
  const id = entityIdentifier.replace(/^saw_post_/, '');
  const { subwireArticleIdentifier } = await import('../../../services/subwireArticleContract');
  return subwireArticleIdentifier(id);
}
