import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AuthProvider } from '../../app/providers/AuthProvider';
import { BridgeProvider } from '../../app/providers/BridgeProvider';
import { QortalBridgeError } from '../../qortal/bridge';
import type { ChatReadPort, ChatSendPort } from '../../qortal/chat';
import type { QdnEnvironment } from '../../qortal/types';
import { makeEnvironment } from '../../test/environment';
import { CONTACT_MESSAGE_MAX_LENGTH } from '../../services/contactMessage';
import { PRIVATE_CHAT_RETENTION } from '../../services/contactRetention';
import {
  resolveContactRecipient,
  type ContactRecipientPorts,
  type ContactRecipientResult,
} from '../../services/contactRecipient';
import { CONTACT_VERIFY_ATTEMPTS, type ContactSendDeps } from '../../services/contactService';
import ContactPage from './ContactPage';

const RECIPIENT = 'QPw4vnk5CBDWkgdXB4vUXCc4DXGEjHVxCA';
const SENDER = 'QSenderAddressForTests000000000000000000';
const SIGNATURE = 'ChatSignatureBase58ValueForTests0000000000000000';
const PUBLISHER = 'Shadow Archives';

const HOSTED = makeEnvironment({
  bridgeAvailable: true,
  isHosted: true,
  context: 'render',
  service: 'APP',
  name: 'Shadow%20Archives',
  publisherName: PUBLISHER,
});

const RESOLVED: ContactRecipientResult = {
  kind: 'resolved',
  recipient: { publisherName: PUBLISHER, address: RECIPIENT, publicKey: 'PUBLIC_KEY' },
};

const RECIPIENT_PORTS: ContactRecipientPorts = {
  resolveNameOwner: async () => RECIPIENT,
  resolvePublicKey: async () => 'PUBLIC_KEY',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

interface Harness {
  readonly deps: ContactSendDeps;
  readonly send: ReturnType<typeof vi.fn>;
  readonly read: ReturnType<typeof vi.fn>;
}

function harness(
  options: {
    /**
     * Context the recipient resolution runs in. Defaults to a send-capable
     * hosted frame. Tests that prove a context is blocked must pass the blocked
     * environment so the production resolver — not a resolved stub — decides.
     */
    readonly environment?: QdnEnvironment;
    readonly ports?: ContactRecipientPorts;
    readonly recipient?: ContactRecipientResult;
    /** Full control over resolution timing; overrides `recipient`/`environment`. */
    readonly resolve?: () => Promise<ContactRecipientResult>;
    readonly attempt?: () => Promise<Awaited<ReturnType<ChatSendPort['send']>>>;
    readonly signatures?: () => Promise<readonly string[] | null>;
  } = {},
): Harness {
  const send = vi.fn(
    options.attempt ??
      (async () => ({
        kind: 'submitted' as const,
        submission: {
          signature: SIGNATURE,
          sender: SENDER,
          recipient: RECIPIENT,
          timestamp: 1,
          raw: {},
        },
      })),
  );
  const read = vi.fn(options.signatures ?? (async () => [SIGNATURE]));
  return {
    deps: {
      resolveRecipient:
        options.resolve ??
        (options.recipient !== undefined
          ? async () => options.recipient as ContactRecipientResult
          : () =>
              resolveContactRecipient(
                options.environment ?? HOSTED,
                options.ports ?? RECIPIENT_PORTS,
              )),
      send: { send } as ChatSendPort,
      read: { recentMessageSignatures: read } as ChatReadPort,
      wait: async () => undefined,
    },
    send,
    read,
  };
}

function renderPage(environment: QdnEnvironment, deps: ContactSendDeps) {
  return render(
    <BridgeProvider environment={environment}>
      <AuthProvider>
        <ContactPage deps={deps} />
      </AuthProvider>
    </BridgeProvider>,
  );
}

describe('ContactPage', () => {
  it('shows the verified retention notice instead of the unverified one-month claim', async () => {
    const { deps } = harness();
    renderPage(HOSTED, deps);

    const notice = await screen.findByText(/Messages are delivered through Qortal private chat/);
    expect(notice).toHaveTextContent('not stored permanently');
    expect(notice).toHaveTextContent(PRIVATE_CHAT_RETENTION.windowLabel);
    expect(notice).toHaveTextContent('depends on the network and node settings');
    expect(notice).toHaveTextContent('Q-Mail');
    expect(notice).not.toHaveTextContent('one month');
    expect(notice).not.toHaveTextContent('1 month');
  });

  it('shows the resolved owner and does not expose the owner address or public key', async () => {
    const { deps } = harness();
    renderPage(HOSTED, deps);

    expect(await screen.findByText(PUBLISHER, { selector: 'strong' })).toBeInTheDocument();
    expect(screen.queryByText(RECIPIENT)).not.toBeInTheDocument();
    expect(screen.queryByText('PUBLIC_KEY')).not.toBeInTheDocument();
  });

  it('blocks sending with a truthful explanation in a plain browser', async () => {
    const environment = makeEnvironment();
    const { deps } = harness({ environment });
    renderPage(environment, deps);

    expect(await screen.findByText(/not running inside a Qortal app frame/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send private message' })).toBeDisabled();
    expect(deps.send.send).not.toHaveBeenCalled();
  });

  it('blocks sending when a published frame has no host bridge', async () => {
    const environment = makeEnvironment({
      isHosted: true,
      context: 'render',
      service: 'APP',
      name: 'Shadow%20Archives',
      publisherName: PUBLISHER,
    });
    const { deps } = harness({ environment });
    renderPage(environment, deps);

    expect(await screen.findByText(/no host bridge is reachable/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send private message' })).toBeDisabled();
    expect(deps.send.send).not.toHaveBeenCalled();
  });

  it('blocks sending when the recipient cannot be resolved', async () => {
    const { deps } = harness({
      recipient: {
        kind: 'unresolved',
        code: 'recipient-not-encryptable',
        message: 'no public key on chain',
      },
    });
    renderPage(HOSTED, deps);

    expect(await screen.findByText('no public key on chain')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send private message' })).toBeDisabled();
    expect(deps.send.send).not.toHaveBeenCalled();
  });

  it('keeps the message field writable while the owner is still resolving', async () => {
    const user = userEvent.setup();
    const gate = deferred<ContactRecipientResult>();
    const { deps } = harness({ resolve: () => gate.promise });
    renderPage(HOSTED, deps);

    // A visitor who starts typing before the node answers must not lose input to
    // a disabled control; only the Send action waits for the recipient.
    const field = screen.getByLabelText('Message');
    expect(field).toBeEnabled();
    await user.type(field, 'typed before the owner resolved');
    expect(field).toHaveValue('typed before the owner resolved');
    expect(screen.getByRole('button', { name: 'Send private message' })).toBeDisabled();

    gate.resolve(RESOLVED);
    expect(await screen.findByText(PUBLISHER, { selector: 'strong' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send private message' })).toBeEnabled();
    expect(field).toHaveValue('typed before the owner resolved');
  });

  it('never discards text typed while a send is in flight', async () => {
    const user = userEvent.setup();
    const gate = deferred<Awaited<ReturnType<ChatSendPort['send']>>>();
    const { deps } = harness({ attempt: () => gate.promise });
    renderPage(HOSTED, deps);

    await screen.findByText(PUBLISHER, { selector: 'strong' });
    const field = await screen.findByLabelText('Message');
    await user.type(field, 'first message');
    await user.click(screen.getByRole('button', { name: 'Send private message' }));

    // The field stays writable while the host is working.
    await user.type(field, ' and a follow-up');

    gate.resolve({
      kind: 'submitted',
      submission: {
        signature: SIGNATURE,
        sender: SENDER,
        recipient: RECIPIENT,
        timestamp: 1,
        raw: {},
      },
    });

    expect(await screen.findByText(/Message sent\./)).toBeInTheDocument();
    // The acknowledged send clears the field only while it still holds exactly
    // the submitted text; anything typed meanwhile is kept rather than lost.
    expect(field).toHaveValue('first message and a follow-up');
  });

  it('sends, reports the truthful outcome and clears the draft only after acknowledgment', async () => {
    const user = userEvent.setup();
    const { deps } = harness();
    renderPage(HOSTED, deps);

    const field = await screen.findByLabelText('Message');
    await user.type(field, 'please verify this record');
    await user.click(screen.getByRole('button', { name: 'Send private message' }));

    const outcome = await screen.findByText(/Message sent\./);
    expect(outcome).toHaveTextContent(/present in the private chat relay/);
    expect(deps.send.send).toHaveBeenCalledTimes(1);
    expect(deps.send.send).toHaveBeenCalledWith({
      recipientAddress: RECIPIENT,
      message: 'please verify this record',
    });
    await waitFor(() => expect(field).toHaveValue(''));
  });

  it('reports submitted-but-unconfirmed as a warning, not as success', async () => {
    const user = userEvent.setup();
    const { deps } = harness({ signatures: async () => ['other-signature'] });
    renderPage(HOSTED, deps);

    await user.type(await screen.findByLabelText('Message'), 'hello');
    await user.click(screen.getByRole('button', { name: 'Send private message' }));

    expect(await screen.findByText(/delivery unconfirmed/i)).toBeInTheDocument();
    expect(screen.queryByText(/^Message sent\.$/)).not.toBeInTheDocument();
  });

  it('preserves the draft on an ambiguous send and warns before resending', async () => {
    const user = userEvent.setup();
    const { deps } = harness({
      attempt: async () => ({
        kind: 'ambiguous',
        error: new QortalBridgeError('timeout', 'The request timed out', 'SEND_CHAT_MESSAGE'),
      }),
    });
    renderPage(HOSTED, deps);

    const field = await screen.findByLabelText('Message');
    await user.type(field, 'important draft');
    await user.click(screen.getByRole('button', { name: 'Send private message' }));

    expect(await screen.findByText('Send result unknown.')).toBeInTheDocument();
    expect(field).toHaveValue('important draft');
    expect(screen.getByRole('button', { name: 'Send again (may duplicate)' })).toBeEnabled();
    // No automatic retry: exactly one host call for one user action.
    expect(deps.send.send).toHaveBeenCalledTimes(1);
  });

  it('preserves the draft when the host approval is declined', async () => {
    const user = userEvent.setup();
    const { deps } = harness({
      attempt: async () => ({
        kind: 'rejected',
        error: new QortalBridgeError(
          'rejected',
          'user declined to send message',
          'SEND_CHAT_MESSAGE',
        ),
      }),
    });
    renderPage(HOSTED, deps);

    const field = await screen.findByLabelText('Message');
    await user.type(field, 'kept draft');
    await user.click(screen.getByRole('button', { name: 'Send private message' }));

    expect(await screen.findByText('Not sent.')).toBeInTheDocument();
    expect(field).toHaveValue('kept draft');
  });

  it('preserves the draft when the send fails before signing', async () => {
    const user = userEvent.setup();
    const { deps } = harness({
      attempt: async () => ({
        kind: 'failed',
        error: new QortalBridgeError(
          'error',
          'you need at least 4 QORT to send a message',
          'SEND_CHAT_MESSAGE',
        ),
      }),
    });
    renderPage(HOSTED, deps);

    const field = await screen.findByLabelText('Message');
    await user.type(field, 'kept draft');
    await user.click(screen.getByRole('button', { name: 'Send private message' }));

    expect(await screen.findByText(/needs at least 4 QORT/)).toBeInTheDocument();
    expect(field).toHaveValue('kept draft');
  });

  it('sends one message when the Send button is double-clicked', async () => {
    const user = userEvent.setup();
    const gate = deferred<Awaited<ReturnType<ChatSendPort['send']>>>();
    const { deps } = harness({ attempt: () => gate.promise });
    renderPage(HOSTED, deps);

    await user.type(await screen.findByLabelText('Message'), 'one message only');
    const button = screen.getByRole('button', { name: 'Send private message' });
    await user.click(button);
    await user.click(button);
    await user.click(button);

    expect(deps.send.send).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();

    gate.resolve({
      kind: 'submitted',
      submission: {
        signature: SIGNATURE,
        sender: SENDER,
        recipient: RECIPIENT,
        timestamp: 1,
        raw: {},
      },
    });

    expect(await screen.findByText(/Message sent\./)).toBeInTheDocument();
    expect(deps.send.send).toHaveBeenCalledTimes(1);
  });

  it('refuses an over-long draft client-side without calling the host', async () => {
    const user = userEvent.setup();
    const { deps } = harness();
    renderPage(HOSTED, deps);

    const field = await screen.findByLabelText('Message');
    // Set the value directly so the textarea maxLength cannot hide the refusal;
    // the shared validator must be what rejects the draft.
    fireEvent.change(field, { target: { value: 'x'.repeat(CONTACT_MESSAGE_MAX_LENGTH + 10) } });
    await user.click(screen.getByRole('button', { name: 'Send private message' }));

    expect(
      await screen.findByText(`Messages are limited to ${CONTACT_MESSAGE_MAX_LENGTH} characters.`),
    ).toBeInTheDocument();
    expect(deps.send.send).not.toHaveBeenCalled();
  });

  it('never calls any transport other than the chat send and the signature read-back', async () => {
    const user = userEvent.setup();
    const { deps } = harness();
    const bridgeCalls: unknown[] = [];
    Object.defineProperty(window, 'qortalRequest', {
      configurable: true,
      writable: true,
      value: (payload: unknown) => {
        bridgeCalls.push(payload);
        return Promise.reject(new Error('the page must not call the global bridge directly'));
      },
    });

    try {
      renderPage(HOSTED, deps);
      await user.type(await screen.findByLabelText('Message'), 'no fallback please');
      await user.click(screen.getByRole('button', { name: 'Send private message' }));
      await screen.findByText(/Message sent\./);

      // The injected ports are the only transport the page uses.
      expect(bridgeCalls).toEqual([]);
      expect(deps.send.send).toHaveBeenCalledTimes(1);
      expect(deps.read.recentMessageSignatures).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(window, 'qortalRequest');
    }
  });

  it('verifies presence at most a bounded number of times', async () => {
    const user = userEvent.setup();
    const { deps } = harness({ signatures: async () => [] });
    renderPage(HOSTED, deps);

    await user.type(await screen.findByLabelText('Message'), 'bounded');
    await user.click(screen.getByRole('button', { name: 'Send private message' }));
    await screen.findByText(/delivery unconfirmed/i);

    expect(deps.read.recentMessageSignatures).toHaveBeenCalledTimes(CONTACT_VERIFY_ATTEMPTS);
  });
});
