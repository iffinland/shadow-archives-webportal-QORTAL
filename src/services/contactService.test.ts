import { describe, expect, it, vi } from 'vitest';

import { QortalBridgeError } from '../qortal/bridge';
import type { ChatReadPort, ChatSendPort, ChatSubmission } from '../qortal/chat';
import type { ContactRecipientResult } from './contactRecipient';
import {
  CONTACT_VERIFY_ATTEMPTS,
  describeFailedSend,
  sendContactMessage,
  type ContactSendDeps,
} from './contactService';

const RECIPIENT = 'QPw4vnk5CBDWkgdXB4vUXCc4DXGEjHVxCA';
const SENDER = 'QSenderAddressForTests000000000000000000';
const SIGNATURE = 'ChatSignatureBase58ValueForTests0000000000000000';

const RESOLVED: ContactRecipientResult = {
  kind: 'resolved',
  recipient: { publisherName: 'Shadow Archives', address: RECIPIENT, publicKey: 'PUBLIC_KEY' },
};

const SUBMISSION: ChatSubmission = {
  signature: SIGNATURE,
  sender: SENDER,
  recipient: RECIPIENT,
  timestamp: 1_789_000_000_000,
  raw: { signature: SIGNATURE },
};

function makeDeps(overrides: Partial<ContactSendDeps> = {}): ContactSendDeps {
  return {
    resolveRecipient: vi.fn(async () => RESOLVED),
    send: {
      send: vi.fn(async () => ({ kind: 'submitted', submission: SUBMISSION })),
    } as ChatSendPort,
    read: {
      recentMessageSignatures: vi.fn(async () => [SIGNATURE]),
    } as ChatReadPort,
    wait: async () => undefined,
    ...overrides,
  };
}

describe('sendContactMessage', () => {
  it('sends the trimmed body to the freshly resolved owner address', async () => {
    const deps = makeDeps();
    const outcome = await sendContactMessage('  hello owner  ', deps);

    expect(outcome.kind).toBe('sent');
    expect(deps.send.send).toHaveBeenCalledTimes(1);
    expect(deps.send.send).toHaveBeenCalledWith({
      recipientAddress: RECIPIENT,
      message: 'hello owner',
    });
  });

  it('reports confirmed only when the node chat read-back shows our signature', async () => {
    const deps = makeDeps();
    const outcome = await sendContactMessage('hi', deps);

    expect(outcome.kind === 'sent' && outcome.delivery).toBe('confirmed');
    expect(deps.read.recentMessageSignatures).toHaveBeenCalledWith({
      sender: SENDER,
      recipient: RECIPIENT,
    });
  });

  it('reports submitted (not confirmed, not failed) when the read-back cannot see it', async () => {
    const deps = makeDeps({
      read: {
        recentMessageSignatures: vi.fn(async () => ['some-other-signature']),
      } as ChatReadPort,
    });
    const outcome = await sendContactMessage('hi', deps);

    expect(outcome.kind === 'sent' && outcome.delivery).toBe('submitted');
    expect(deps.read.recentMessageSignatures).toHaveBeenCalledTimes(CONTACT_VERIFY_ATTEMPTS);
  });

  it('stays submitted when the read-back itself is unavailable', async () => {
    const deps = makeDeps({
      read: { recentMessageSignatures: vi.fn(async () => null) } as ChatReadPort,
    });
    const outcome = await sendContactMessage('hi', deps);
    expect(outcome.kind === 'sent' && outcome.delivery).toBe('submitted');
  });

  it('does not attempt a read-back without a signature or sender address', async () => {
    const deps = makeDeps({
      send: {
        send: vi.fn(async () => ({
          kind: 'submitted',
          submission: { ...SUBMISSION, signature: null, sender: null },
        })),
      } as ChatSendPort,
    });
    const outcome = await sendContactMessage('hi', deps);
    expect(outcome.kind === 'sent' && outcome.delivery).toBe('submitted');
    expect(deps.read.recentMessageSignatures).not.toHaveBeenCalled();
  });

  it('never retries an ambiguous send and never reports it as success', async () => {
    const deps = makeDeps({
      send: {
        send: vi.fn(async () => ({
          kind: 'ambiguous',
          error: new QortalBridgeError(
            'timeout',
            'Request timed out: SEND_CHAT_MESSAGE',
            'SEND_CHAT_MESSAGE',
          ),
        })),
      } as ChatSendPort,
    });
    const outcome = await sendContactMessage('hi', deps);

    expect(outcome.kind).toBe('ambiguous');
    expect(deps.send.send).toHaveBeenCalledTimes(1);
    expect(deps.read.recentMessageSignatures).not.toHaveBeenCalled();
    expect(deps.resolveRecipient).toHaveBeenCalledTimes(1);
  });

  it('reports a declined host approval as rejected with nothing sent', async () => {
    const deps = makeDeps({
      send: {
        send: vi.fn(async () => ({
          kind: 'rejected',
          error: new QortalBridgeError(
            'rejected',
            'user declined to send message',
            'SEND_CHAT_MESSAGE',
          ),
        })),
      } as ChatSendPort,
    });
    const outcome = await sendContactMessage('hi', deps);
    expect(outcome.kind).toBe('rejected');
    expect(deps.read.recentMessageSignatures).not.toHaveBeenCalled();
  });

  it('maps an insufficient-balance host error to actionable truth', async () => {
    const deps = makeDeps({
      send: {
        send: vi.fn(async () => ({
          kind: 'failed',
          error: new QortalBridgeError(
            'error',
            'you need at least 4 QORT to send a message',
            'SEND_CHAT_MESSAGE',
          ),
        })),
      } as ChatSendPort,
    });
    const outcome = await sendContactMessage('hi', deps);
    expect(outcome.kind === 'failed' && outcome.code).toBe('insufficient-balance');
  });

  it('maps a host public-key failure to a recipient-encryption truth', async () => {
    const deps = makeDeps({
      send: {
        send: vi.fn(async () => ({
          kind: 'failed',
          error: new QortalBridgeError(
            'error',
            'Cannot send an encrypted message to this user since they do not have their publickey on chain.',
            'SEND_CHAT_MESSAGE',
          ),
        })),
      } as ChatSendPort,
    });
    const outcome = await sendContactMessage('hi', deps);
    expect(outcome.kind === 'failed' && outcome.code).toBe('recipient-not-encryptable');
  });

  it('refuses an over-long draft before any host call', async () => {
    const deps = makeDeps();
    const outcome = await sendContactMessage('', deps);

    expect(outcome.kind === 'failed' && outcome.code).toBe('invalid-message');
    expect(deps.resolveRecipient).not.toHaveBeenCalled();
    expect(deps.send.send).not.toHaveBeenCalled();
  });

  it('fails closed with no send attempt when the recipient cannot be resolved', async () => {
    const deps = makeDeps({
      resolveRecipient: vi.fn<ContactSendDeps['resolveRecipient']>(async () => ({
        kind: 'unresolved' as const,
        code: 'name-unresolved' as const,
        message: 'recipient could not be resolved',
      })),
    });
    const outcome = await sendContactMessage('hi', deps);

    expect(outcome.kind === 'failed' && outcome.code).toBe('recipient-unresolved');
    expect(deps.send.send).not.toHaveBeenCalled();
  });

  it('keeps the recipient-encryption failure code when resolution proves no public key', async () => {
    const deps = makeDeps({
      resolveRecipient: vi.fn<ContactSendDeps['resolveRecipient']>(async () => ({
        kind: 'unresolved' as const,
        code: 'recipient-not-encryptable' as const,
        message: 'no public key',
      })),
    });
    const outcome = await sendContactMessage('hi', deps);
    expect(outcome.kind === 'failed' && outcome.code).toBe('recipient-not-encryptable');
    expect(deps.send.send).not.toHaveBeenCalled();
  });
});

describe('describeFailedSend', () => {
  it('explains the node chat rate limit instead of echoing a raw validation error', () => {
    const described = describeFailedSend(
      new QortalBridgeError(
        'error',
        'account has too many unconfirmed transactions pending TOO_MANY_UNCONFIRMED',
        'SEND_CHAT_MESSAGE',
      ),
    );
    expect(described.code).toBe('too-many-pending');
    expect(described.message).toContain('Nothing was sent.');
  });

  it('keeps a missing bridge distinct from a host refusal', () => {
    expect(
      describeFailedSend(new QortalBridgeError('unavailable', 'no bridge', 'SEND_CHAT_MESSAGE'))
        .code,
    ).toBe('bridge-unavailable');
    expect(
      describeFailedSend(new QortalBridgeError('error', 'boom', 'SEND_CHAT_MESSAGE')).code,
    ).toBe('send-failed');
  });

  it('recognizes the localized required-balance error key', () => {
    expect(
      describeFailedSend(
        new QortalBridgeError('error', 'group:message.error.qortals_required', 'S'),
      ).code,
    ).toBe('insufficient-balance');
  });
});
