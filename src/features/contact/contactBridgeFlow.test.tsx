/**
 * Production-wiring test: the Contact page with NO injected dependencies, so the
 * real `createContactSendDeps` graph runs against a fake injected bridge.
 *
 * This is the closest automated evidence to the real host flow that can be
 * produced without performing an authorized live private-message send. It pins:
 * - the exact bridge action sequence and request shapes;
 * - that the recipient is derived from the injected publishing name, never
 *   hardcoded;
 * - that no other transport (public chat, Q-Mail, QDN publish) is ever called.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AuthProvider } from '../../app/providers/AuthProvider';
import { BridgeProvider } from '../../app/providers/BridgeProvider';
import { makeEnvironment } from '../../test/environment';
import ContactPage from './ContactPage';

const PUBLISHER = 'Shadow Archives';
const ENCODED_NAME = 'Shadow%20Archives';
const OWNER = 'QPw4vnk5CBDWkgdXB4vUXCc4DXGEjHVxCA';
const OWNER_PUBLIC_KEY = '2q9PKM4yBmqiZhx6q54wEFGJHUvfmddpbBQ8J6UXfDfv';
const SENDER = 'QFromAddressForTests00000000000000000000';
const SIGNATURE = 'ChatSignatureBase58ValueForTests0000000000000000';
const TIMESTAMP = 1_760_000_000_000;

/** Every bridge action the Contact flow may use, and nothing else. */
const ALLOWED_ACTIONS = [
  'GET_NAME_DATA',
  'GET_ACCOUNT_DATA',
  'SEND_CHAT_MESSAGE',
  'SEARCH_CHAT_MESSAGES',
] as const;

const HOSTED = makeEnvironment({
  bridgeAvailable: true,
  isHosted: true,
  context: 'render',
  service: 'APP',
  name: ENCODED_NAME,
  publisherName: PUBLISHER,
});

type Payload = Record<string, unknown>;

interface FakeBridge {
  readonly calls: readonly Payload[];
  /** Live view: recomputed per access, not a snapshot of an empty array. */
  readonly actions: readonly string[];
}

function installBridge(overrides: Record<string, (payload: Payload) => unknown> = {}): FakeBridge {
  const calls: Payload[] = [];
  const answers: Record<string, (payload: Payload) => unknown> = {
    GET_NAME_DATA: () => ({ name: PUBLISHER, owner: OWNER }),
    GET_ACCOUNT_DATA: () => ({ address: OWNER, publicKey: OWNER_PUBLIC_KEY }),
    SEND_CHAT_MESSAGE: () => ({
      type: 'CHAT',
      signature: SIGNATURE,
      // Verified `/transactions/process?apiVersion=2` shape: the marshalled
      // TransactionData exposes the sender as `creatorAddress`.
      creatorAddress: SENDER,
      recipient: OWNER,
      timestamp: TIMESTAMP,
      txGroupId: 0,
      approvalStatus: 'NOT_REQUIRED',
    }),
    SEARCH_CHAT_MESSAGES: () => [
      { signature: SIGNATURE, sender: SENDER, recipient: OWNER, isEncrypted: 1 },
    ],
    ...overrides,
  };

  Object.defineProperty(window, 'qortalRequest', {
    configurable: true,
    writable: true,
    value: (payload: Payload) => {
      calls.push(payload);
      const action = String(payload.action);
      const answer = answers[action];
      if (!answer) return Promise.reject(new Error(`unexpected action ${action}`));
      return Promise.resolve(answer(payload));
    },
  });

  return {
    calls,
    get actions() {
      return calls.map((payload) => String(payload.action));
    },
  };
}

function renderPage() {
  return render(
    <BridgeProvider environment={HOSTED}>
      <AuthProvider>
        <ContactPage />
      </AuthProvider>
    </BridgeProvider>,
  );
}

afterEach(() => {
  Reflect.deleteProperty(window, 'qortalRequest');
});

describe('Contact flow over the production bridge graph', () => {
  it('resolves the owner from the injected name and sends exactly one private chat message', async () => {
    const user = userEvent.setup();
    const bridge = installBridge();
    renderPage();

    // The recipient block shows the publishing name only.
    expect(await screen.findByText(PUBLISHER, { selector: 'strong' })).toBeInTheDocument();

    const field = await screen.findByLabelText('Message');
    await user.type(field, 'Please verify record 12.');
    await user.click(screen.getByRole('button', { name: 'Send private message' }));

    expect(await screen.findByText(/Message sent\./)).toBeInTheDocument();

    const sends = bridge.calls.filter((payload) => payload.action === 'SEND_CHAT_MESSAGE');
    expect(sends).toHaveLength(1);
    // Exact request shape: the app must not invent a subject, group, public key,
    // encryption flag or message id. The host owns all of that.
    expect(sends[0]).toEqual({
      action: 'SEND_CHAT_MESSAGE',
      destinationAddress: OWNER,
      message: 'Please verify record 12.',
    });

    // The recipient was derived from the name the host injected for this frame,
    // never from a constant in the bundle.
    expect(bridge.calls[0]).toEqual({ action: 'GET_NAME_DATA', name: ENCODED_NAME });
    expect(bridge.calls[1]).toEqual({ action: 'GET_ACCOUNT_DATA', address: OWNER });

    // Read-back proof is signature-only: no message content is ever fetched.
    const reads = bridge.calls.filter((payload) => payload.action === 'SEARCH_CHAT_MESSAGES');
    expect(reads).toHaveLength(1);
    expect(reads[0]).toEqual({
      action: 'SEARCH_CHAT_MESSAGES',
      involving: [SENDER, OWNER],
      encoding: 'BASE64',
      limit: 50,
      reverse: true,
    });
  });

  it('never uses another transport, and clears the draft only after acknowledgment', async () => {
    const user = userEvent.setup();
    const bridge = installBridge();
    renderPage();

    // A real visitor only clicks Send once the owner has resolved; gate on the
    // same visible signal instead of racing the resolver.
    await screen.findByText(PUBLISHER, { selector: 'strong' });
    const field = await screen.findByLabelText('Message');
    await user.type(field, 'hello owner');
    await user.click(screen.getByRole('button', { name: 'Send private message' }));
    await screen.findByText(/Message sent\./);

    // No public chat, QDN publish, Q-Mail or unrelated transaction action.
    for (const action of bridge.actions) {
      expect(ALLOWED_ACTIONS).toContain(action);
    }
    expect(bridge.actions.filter((action) => action === 'SEND_CHAT_MESSAGE')).toHaveLength(1);

    await vi.waitFor(() => expect(field).toHaveValue(''));
  });

  it('reports submitted-but-unconfirmed when the node chat list lacks our signature', async () => {
    const user = userEvent.setup();
    installBridge({ SEARCH_CHAT_MESSAGES: () => [] });
    renderPage();

    await screen.findByText(PUBLISHER, { selector: 'strong' });
    await user.type(await screen.findByLabelText('Message'), 'unconfirmed please');
    await user.click(screen.getByRole('button', { name: 'Send private message' }));

    expect(await screen.findByText(/delivery unconfirmed/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Message sent\.$/)).not.toBeInTheDocument();
    // The production verification uses a real bounded backoff (3 × 1.5 s).
  }, 20_000);

  it('fails closed with the real resolver in a plain browser and calls no transport', async () => {
    const bridge = installBridge();
    render(
      <BridgeProvider environment={makeEnvironment()}>
        <AuthProvider>
          <ContactPage />
        </AuthProvider>
      </BridgeProvider>,
    );

    expect(await screen.findByText(/not running inside a Qortal app frame/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send private message' })).toBeDisabled();
    expect(bridge.calls).toEqual([]);
  });
});
