import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AppProviders } from '../../../app/providers/AppProviders';
import { useCapability } from '../../../app/providers/CapabilityProvider';
import { resetAuthSession } from '../../../qortal/auth';
import { QortalBridgeError } from '../../../qortal/bridge';
import type { PublishAttempt, PublishPort, PublishResourceInput } from '../../../qortal/publish';
import type { RichTextDocument, RichTextNode } from '../../../domain/types';
import type { CachePutOptions, CacheRecord, ContentCache } from '../../../services/cache';
import type { QdnReadPort } from '../../../services/qdnReader';
import { makeEnvironment } from '../../../test/environment';
import { makeArchiveSnapshot } from '../../../test/fixtures/content';
import {
  createAboutPublishDeps,
  type AboutPublishDeps,
} from '../../../services/aboutPublishService';
import { AboutPublishModal } from './AboutPublishModal';

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

const INITIAL_DOC: RichTextNode = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Old About text.' }] }],
};

const BODY: RichTextDocument = {
  format: 'tiptap-json-v1',
  doc: {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'New About text.' }] }],
  },
};

function installOwnerBridge() {
  const mock = vi.fn((payload: Record<string, unknown>) => {
    switch (payload.action) {
      case 'GET_USER_ACCOUNT':
        return Promise.resolve({ address: OWNER, publicKey: 'K' });
      case 'GET_ACCOUNT_NAMES':
        return Promise.resolve([{ name: PUBLISHER, owner: OWNER }]);
      case 'GET_NAME_DATA':
        return Promise.resolve({ name: PUBLISHER, owner: OWNER });
      default:
        return Promise.reject(new Error(`Unexpected bridge action: ${String(payload.action)}`));
    }
  });
  Object.defineProperty(window, 'qortalRequest', {
    configurable: true,
    writable: true,
    value: mock,
  });
}

function memoryCache(): ContentCache {
  const store = new Map<string, CacheRecord<unknown>>();
  return {
    async get<T>(key: string, version = 1) {
      const record = store.get(key) as CacheRecord<T> | undefined;
      if (!record || record.version !== version) return null;
      return record;
    },
    async put<T>(key: string, value: T, options: CachePutOptions) {
      store.set(key, { key, value, storedAt: 0, expiresAt: options.ttlMs, version: 1 });
    },
    async delete(key: string) {
      store.delete(key);
    },
    async clear() {
      store.clear();
    },
  };
}

function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

interface Harness {
  readonly deps: AboutPublishDeps;
  readonly calls: PublishResourceInput[][];
  readonly fetches: number;
}

function harness(
  attemptFor: (resources: readonly PublishResourceInput[]) => PublishAttempt,
): Harness {
  const calls: PublishResourceInput[][] = [];
  let written: string | null = null;
  let fetches = 0;

  const port: PublishPort = {
    async publishResource(resource) {
      calls.push([resource]);
      if (typeof resource.data64 === 'string') written = decodeBase64Utf8(resource.data64);
      return attemptFor([resource]);
    },
    async publishResources(resources) {
      calls.push([...resources]);
      return attemptFor(resources);
    },
  };

  const reader: QdnReadPort = {
    async search() {
      return [];
    },
    async fetchText() {
      fetches += 1;
      if (written === null) throw new QortalBridgeError('error', 'missing', 'FETCH_QDN_RESOURCE');
      return written;
    },
  };

  return {
    calls,
    get fetches() {
      return fetches;
    },
    deps: {
      ...createAboutPublishDeps(),
      reader,
      writer: port,
      cache: memoryCache(),
      now: () => 1_700_000_000_000,
    },
  };
}

function OwnerProbe() {
  const { isOwner } = useCapability();
  return <span data-testid="owner-probe">{isOwner ? 'owner' : 'not-owner'}</span>;
}

function renderModal(deps: AboutPublishDeps) {
  return render(
    <AppProviders
      environment={HOSTED}
      archiveLoader={async () => makeArchiveSnapshot({ status: 'empty', source: 'none' })}
    >
      <OwnerProbe />
      <AboutPublishModal
        initialDoc={INITIAL_DOC}
        onClose={() => undefined}
        onPublished={() => undefined}
        deps={deps}
        renderEditor={({ onChange, disabled }) => (
          <button type="button" disabled={disabled} onClick={() => onChange(BODY)}>
            Write body
          </button>
        )}
      />
    </AppProviders>,
  );
}

async function waitForOwner() {
  await waitFor(() => expect(screen.getByTestId('owner-probe')).toHaveTextContent('owner'));
}

afterEach(() => {
  resetAuthSession();
  Reflect.deleteProperty(window, 'qortalRequest');
});

describe('AboutPublishModal', () => {
  it('publishes one resource, re-reads it and reports success', async () => {
    installOwnerBridge();
    const user = userEvent.setup();
    const h = harness((resources) => ({
      kind: 'submitted',
      submissions: resources.map((resource) => ({
        service: resource.service,
        identifier: resource.identifier ?? null,
        name: resource.name,
        signature: 's',
        raw: {},
      })),
    }));
    renderModal(h.deps);
    await waitForOwner();

    await user.click(screen.getByRole('button', { name: 'Write body' }));
    await user.click(screen.getByRole('button', { name: 'Save About page' }));

    expect(await screen.findByText('Published')).toBeInTheDocument();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0][0]).toMatchObject({
      service: 'DOCUMENT',
      name: PUBLISHER,
      identifier: 'saw_about',
    });
    expect(h.fetches).toBe(1);
  });

  it('reports an ambiguous submission without retrying or claiming success', async () => {
    installOwnerBridge();
    const user = userEvent.setup();
    const h = harness(() => ({
      kind: 'ambiguous',
      error: new QortalBridgeError('timeout', 'timed out', 'PUBLISH_QDN_RESOURCE'),
    }));
    renderModal(h.deps);
    await waitForOwner();

    await user.click(screen.getByRole('button', { name: 'Write body' }));
    await user.click(screen.getByRole('button', { name: 'Save About page' }));

    expect(await screen.findByText('Submission result unknown')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify served content' })).toBeInTheDocument();
    expect(h.calls).toHaveLength(1);
    expect(h.fetches).toBe(0);
  });
});
